/**
 * 增量质量检查的文件范围工具（eslint-config 的 rules/quality-scope）真实行为回归。
 *
 * 该模块决定"哪些文件参与本次注释检查、哪些行算作本次改动"：Git 边界或排除规则写错会
 * 让依赖目录、生成物或归档进入扫描范围；显式范围越界不拒绝会让检查范围悄悄扩大；
 * 增量行算错会让本轮改动的注释问题被漏掉或被删除的行误报；历史编码无效时不退回整份
 * 检查会让旧文件跳过注释门禁；未跟踪文件不按全量处理会让新增文件永远不被检查。
 * 用例使用真实临时目录、真实 Git 仓库与真实文件系统驱动，只替换时间与随机性无关的
 * 断言目标，不替换被测实现。
 */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  baselineScope,
  changedFiles,
  changedLines,
  discover,
  git,
  gitBytes,
  readText,
  repositoryRoot,
  safePath,
  trackedFiles,
  webRequest,
} from './quality-scope.mjs';

/** TypeScript 源码后缀集合，用于验证后缀过滤。 */
const TS_EXTENSIONS = new Set(['.ts']);

/** 本用例创建并需要在结束时清理的临时目录。 */
const createdRoots = [];

afterEach(
  /** 递归删除本用例创建的临时目录，避免残留影响后续运行。 */ () => {
    for (const root of createdRoots) {
      rmSync(root, { force: true, recursive: true });
    }
    createdRoots.length = 0;
  },
);

/**
 * 建立一个独占的临时目录。
 * @param prefix 目录名前缀，便于定位残留。
 * @returns 临时目录的绝对路径。
 */
function createTempDirectory(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  createdRoots.push(root);
  return root;
}

/**
 * 在指定 Git 仓库中执行命令，失败即抛出。
 * @param root 仓库根目录。
 * @param args 独立 Git 参数，不经过 Shell。
 * @returns 标准输出文本。
 * @throws Error Git 以非零状态退出时抛出，包含标准错误内容。
 */
function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Git 命令失败：${result.stderr}`);
  }
  return result.stdout;
}

/**
 * 在目录中写入文本文件，必要时创建父目录。
 * @param root 目标根目录。
 * @param files 相对路径到文件内容的映射。
 */
function writeFiles(root, files) {
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/**
 * 用固定的本地身份提交当前暂存内容，避免依赖宿主 Git 配置。
 * @param root 仓库根目录。
 */
function commitAll(root) {
  runGit(root, [
    '-c',
    'user.name=DUMMY-tester',
    '-c',
    'user.email=DUMMY-tester@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--no-verify',
    '-m',
    'DUMMY-初始提交',
  ]);
}

/**
 * 初始化真实 Git 仓库并产生一次提交。
 * @param root 仓库根目录。
 * @param files 首次提交包含的文件。
 */
function initRepository(root, files) {
  writeFiles(root, files);
  runGit(root, ['init']);
  runGit(root, ['add', '-A']);
  commitAll(root);
}

/**
 * 取得扫描结果相对仓库根的正斜杠路径列表。
 * @param files discover 返回的真实文件路径列表。
 * @param root 仓库根目录。
 * @returns 排序后的相对路径列表。
 */
function relativePaths(files, root) {
  return files.map(
    /** 统一转换成正斜杠相对路径，便于跨平台断言。 */ (file) =>
      relative(root, file).split('\\').join('/'),
  );
}

describe('git 调用边界', /** Git 是所有发现与增量逻辑的基础，失败必须显式抛出。 */ () => {
  it('读取 Git 标准输出并使用 C 语言环境', /** 依赖本机语言环境会让文件路径解析结果不稳定。 */ () => {
    const root = createTempDirectory('scope-git-');
    runGit(root, ['init']);

    expect(git(root, 'rev-parse', '--is-inside-work-tree')).toBe('true\n');
    expect(gitBytes(root, 'rev-parse', '--is-inside-work-tree')).toBeInstanceOf(
      Uint8Array,
    );
  });

  it('非零状态退出时抛出含原因的检查失败', /** 静默返回空输出会让上层把失败当成"没有文件"。 */ () => {
    const root = createTempDirectory('scope-git-fail-');

    expect(
      /** 在非 Git 目录执行版本库命令会失败。 */ () =>
        git(root, 'rev-parse', '--verify', 'HEAD'),
    ).toThrowError(/Git 检查失败/u);
  });

  it('从子目录向上找到真实 Git 边界', /** 边界找错会让增量检查的路径基准整体偏移。 */ () => {
    const root = createTempDirectory('scope-repo-');
    initRepository(root, { 'a.ts': 'export const a = 1;\n' });
    const nested = join(root, 'packages', 'app');
    mkdirSync(nested, { recursive: true });

    // Git 在 Windows 上按正斜杠输出仓库根，且不保证与文件系统同一大小写或长短名形式；
    // 两侧都归一到真实路径后比较，核对的是"同一个目录"而不是平台路径写法。
    expect(repositoryRoot(nested)).toBe(
      realpathSync(runGit(nested, ['rev-parse', '--show-toplevel']).trim()),
    );
  });

  it('没有 Git 边界时要求显式指定全量目录', /** 静默回退到当前目录会让检查范围与预期不符。 */ () => {
    const root = createTempDirectory('scope-no-repo-');

    expect(
      /** 临时目录之上不存在版本库边界。 */ () => repositoryRoot(root),
    ).toThrowError(/增量检查需要 Git 仓库/u);
  });
});

describe('路径与文件读取', /** 路径校验与读取上限是避免越界扫描与内存爆掉的关键守卫。 */ () => {
  it('解析仓库内真实路径', /** 未解析符号链接会让排除规则被绕过。 */ () => {
    const root = createTempDirectory('scope-path-');
    writeFiles(root, { 'a.ts': 'export const a = 1;\n' });

    expect(safePath(root, 'a.ts')).toBe(join(root, 'a.ts'));
  });

  it('拒绝越界路径、排除区域与不存在的目标', /** 放行越界或依赖目录会让检查扫描到仓库外或第三方文件。 */ () => {
    const root = createTempDirectory('scope-path-reject-');
    writeFiles(root, { 'node_modules/a.ts': 'export const a = 1;\n' });
    const outside = createTempDirectory('scope-path-outside-');
    writeFiles(outside, { 'outside.ts': 'export const outside = 1;\n' });
    const outsideName = relative(dirname(root), outside).split('\\').join('/');

    expect(
      /** 以相对路径逃出仓库根。 */ () =>
        safePath(root, `../${outsideName}/outside.ts`),
    ).toThrowError(/路径越界或指向排除区域/u);
    expect(
      /** 指向排除目录内的文件。 */ () => safePath(root, 'node_modules/a.ts'),
    ).toThrowError(/路径越界或指向排除区域/u);
    expect(
      /** 目标文件不存在。 */ () => safePath(root, 'missing.ts'),
    ).toThrowError();
  });

  it('读取 UTF-8 文本并去掉文件头 BOM', /** BOM 残留会让首行声明解析失败。 */ () => {
    const root = createTempDirectory('scope-read-');
    const file = join(root, 'a.ts');
    writeFileSync(
      file,
      Buffer.concat([Buffer.from('\uFEFF', 'utf8'), Buffer.from('内容\n')]),
    );

    expect(readText(file)).toBe('内容\n');
  });

  it('拒绝非法 UTF-8 与超过 16 MiB 的文件', /** 非法编码与超大文件会让解析器崩溃或耗尽内存。 */ () => {
    const root = createTempDirectory('scope-read-reject-');
    const invalid = join(root, 'invalid.ts');
    writeFileSync(invalid, Buffer.from([255]));
    const oversized = join(root, 'oversized.ts');
    writeFileSync(oversized, Buffer.alloc(16 * 1024 * 1024 + 1));

    expect(
      /** 当前文件存在无效编码。 */ () => readText(invalid),
    ).toThrowError();
    expect(
      /** 当前文件超过读取上限。 */ () => readText(oversized),
    ).toThrowError(/文件超过 16 MiB/u);
  });
});

describe('源码发现', /** 发现范围决定门禁到底检查了哪些文件。 */ () => {
  it('在 Git 仓库中按后缀与排除规则发现文件', /** 漏掉未跟踪文件会让新增文件逃过检查，混入依赖目录会拖慢并污染结果。 */ () => {
    const root = createTempDirectory('scope-discover-');
    initRepository(root, {
      '.gitignore': 'ignored.ts\n',
      'a.ts': 'export const a = 1;\n',
      'sub/b.ts': 'export const b = 1;\n',
      'plain.js': 'export const plain = 1;\n',
      'deleted.ts': 'export const deleted = 1;\n',
    });
    writeFiles(root, {
      'dist/d.ts': 'export const d = 1;\n',
      'ignored.ts': 'export const ignored = 1;\n',
      'node_modules/c.ts': 'export const c = 1;\n',
      'untracked.ts': 'export const untracked = 1;\n',
    });
    runGit(root, ['add', '-f', 'dist/d.ts', 'node_modules/c.ts']);
    // 已跟踪但工作区已删除的文件不能进入扫描范围。
    rmSync(join(root, 'deleted.ts'));
    symlinkSync(join(root, 'a.ts'), join(root, 'link.ts'));

    const files = discover(root, [], TS_EXTENSIONS);

    expect(relativePaths(files, root)).toEqual([
      'a.ts',
      'sub/b.ts',
      'untracked.ts',
    ]);
  });

  it('按显式范围限定目录或单个文件', /** 范围过滤写错会让定向检查变成全量检查。 */ () => {
    const root = createTempDirectory('scope-discover-scope-');
    initRepository(root, {
      'a.ts': 'export const a = 1;\n',
      'sub/b.ts': 'export const b = 1;\n',
      'sub/c.js': 'export const c = 1;\n',
    });

    expect(relativePaths(discover(root, ['sub'], TS_EXTENSIONS), root)).toEqual(
      ['sub/b.ts'],
    );
    expect(
      relativePaths(discover(root, ['a.ts'], TS_EXTENSIONS), root),
    ).toEqual(['a.ts']);
  });

  it('显式范围越界时直接失败', /** 越界范围被忽略会让用户以为检查了目标文件。 */ () => {
    const root = createTempDirectory('scope-discover-escape-');
    initRepository(root, { 'a.ts': 'export const a = 1;\n' });
    const outside = createTempDirectory('scope-discover-outside-');
    writeFiles(outside, { 'outside.ts': 'export const outside = 1;\n' });
    const outsideName = relative(dirname(root), outside).split('\\').join('/');

    expect(
      /** 显式范围指向仓库之外。 */ () =>
        discover(root, [`../${outsideName}/outside.ts`], TS_EXTENSIONS),
    ).toThrowError(/路径越界或指向排除区域/u);
  });

  it('非 Git 目录遍历时跳过符号链接与排除目录', /** 跟随符号链接会扫描到仓库外，进入依赖目录会扫描第三方文件。 */ () => {
    const root = createTempDirectory('scope-walk-');
    writeFiles(root, {
      'dist/d.ts': 'export const d = 1;\n',
      'keep/a.ts': 'export const a = 1;\n',
      'keep/nested/b.ts': 'export const b = 1;\n',
      'node_modules/c.ts': 'export const c = 1;\n',
    });
    const outside = createTempDirectory('scope-walk-outside-');
    writeFiles(outside, { 'e.ts': 'export const e = 1;\n' });
    symlinkSync(join(outside, 'e.ts'), join(root, 'link.ts'));

    const files = discover(root, [], TS_EXTENSIONS);

    expect(relativePaths(files, root)).toEqual([
      'keep/a.ts',
      'keep/nested/b.ts',
    ]);
  });
});

describe('增量行计算', /** 行号算错会让本轮改动漏检或把未改动的旧注释判为问题。 */ () => {
  it('返回新增与修改的行号，未变化时为空', /** 多报行号会让未改动代码被反复要求补注释。 */ () => {
    expect(changedLines('a\nb\nc\n', 'a\nB\nc\n')).toEqual([2]);
    expect(changedLines('a\nb\n', 'a\nb\nc\n')).toEqual([3]);
    expect(changedLines('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('删除行映射到邻接行以便发现被移除的注释', /** 删除声明后不检查邻接行会漏掉注释缺失。 */ () => {
    expect(changedLines('a\nb\nc\n', 'a\nc\n')).toEqual([2]);
  });

  it('统一换行符后再比较', /** CRLF 与 LF 混用会让整份文件被误判为改动。 */ () => {
    expect(changedLines('a\r\nb\r\n', 'a\nb\nc\n')).toEqual([3]);
  });

  it('目标文本为空时不返回行号', /** 空文件没有可检查的声明，返回行号只会制造噪音。 */ () => {
    expect(changedLines('a\nb\n', '')).toEqual([]);
  });

  it('保持行号升序且不重复', /** 重复行号会让同一声明被多次诊断。 */ () => {
    expect(changedLines('a\nb\nc\nd\n', 'a\nX\nY\nd\n')).toEqual([2, 3]);
  });
});

describe('历史基线范围', /** 历史编码不可信时必须扩大检查范围而不是跳过。 */ () => {
  it('合法历史按增量行检查当前文件', /** 能比较出增量却整份检查会让门禁报告大量历史问题。 */ () => {
    expect(baselineScope(Buffer.from('a\nb\n'), 'a\nb\nc\n')).toEqual({
      lines: [3],
      new: false,
    });
  });

  it('历史编码无效时退回整份检查并标记新文件', /** 猜测历史编码会让当前文件的部分声明逃过检查。 */ () => {
    expect(baselineScope(Buffer.from([255]), 'a\n')).toEqual({
      lines: null,
      new: true,
    });
  });
});

describe('跟踪集合与工作区变化', /** 是否已跟踪决定增量比较的基线来源。 */ () => {
  it('非 Git 根目录无法提供增量基线', /** 静默返回空集合会让增量检查失去意义。 */ () => {
    const root = createTempDirectory('scope-tracked-fail-');

    expect(/** 目录不是 Git 根。 */ () => trackedFiles(root)).toThrowError(
      /增量检查需要 Git 根目录/u,
    );
  });

  it('尚无提交的仓库返回空跟踪集合', /** 空仓库取不到 HEAD 时不能把暂存文件当成历史基线。 */ () => {
    const root = createTempDirectory('scope-tracked-empty-');
    runGit(root, ['init']);
    writeFiles(root, { 'a.ts': 'export const a = 1;\n' });
    runGit(root, ['add', 'a.ts']);

    expect(trackedFiles(root).size).toBe(0);
  });

  it('已提交仓库返回 HEAD 跟踪的路径集合', /** 跟踪清单算错会让增量比较读错历史内容。 */ () => {
    const root = createTempDirectory('scope-tracked-');
    initRepository(root, {
      'a.ts': 'export const a = 1;\n',
      'sub/b.ts': 'export const b = 1;\n',
    });

    expect([...trackedFiles(root)].toSorted()).toEqual(['a.ts', 'sub/b.ts']);
  });

  it('尚无提交时把暂存与未跟踪文件都算作变化', /** 新仓库漏掉暂存文件会让首轮提交跳过注释检查。 */ () => {
    const root = createTempDirectory('scope-changed-empty-');
    runGit(root, ['init']);
    writeFiles(root, {
      'a.ts': 'export const a = 1;\n',
      'untracked.ts': 'export const untracked = 1;\n',
    });
    runGit(root, ['add', 'a.ts']);

    expect([...changedFiles(root)].toSorted()).toEqual([
      'a.ts',
      'untracked.ts',
    ]);
  });

  it('有提交时包含已修改与未跟踪文件', /** 漏掉未跟踪文件会让新增测试或源码不被检查。 */ () => {
    const root = createTempDirectory('scope-changed-');
    initRepository(root, {
      'a.ts': 'export const a = 1;\n',
      'b.ts': 'export const b = 1;\n',
    });
    writeFiles(root, {
      'a.ts': 'export const a = 2;\n',
      'new.ts': 'export const fresh = 1;\n',
    });

    expect([...changedFiles(root)].toSorted()).toEqual(['a.ts', 'new.ts']);
  });
});

describe('检查请求组装', /** 请求里的行号与正文直接决定解析器检查哪些声明。 */ () => {
  it('未跟踪文件按整份内容检查', /** 未跟踪文件缺少历史基线，必须整份检查。 */ () => {
    const root = createTempDirectory('scope-request-fresh-');
    initRepository(root, { 'a.ts': 'export const a = 1;\n' });
    writeFiles(root, { 'new.ts': 'export const fresh = 1;\n' });

    expect(
      webRequest(
        root,
        join(root, 'new.ts'),
        'export const fresh = 1;\n',
        new Set(),
      ),
    ).toEqual({
      lines: null,
      new: true,
      path: 'new.ts',
      source: 'export const fresh = 1;\n',
    });
  });

  it('已跟踪文件按 HEAD 内容比较出增量行', /** 不读历史内容会让增量范围退化成整份检查。 */ () => {
    const root = createTempDirectory('scope-request-tracked-');
    initRepository(root, { 'a.ts': 'export const a = 1;\n' });

    expect(
      webRequest(
        root,
        join(root, 'a.ts'),
        'export const a = 2;\n',
        new Set(['a.ts']),
      ),
    ).toEqual({
      lines: [1],
      new: false,
      path: 'a.ts',
      source: 'export const a = 2;\n',
    });
  });

  it('全量检查时所有文件都按整份内容处理', /** 全量模式仍走增量会让部分声明逃过检查。 */ () => {
    const root = createTempDirectory('scope-request-all-');
    initRepository(root, { 'a.ts': 'export const a = 1;\n' });

    expect(
      webRequest(root, join(root, 'a.ts'), 'export const a = 1;\n', null),
    ).toEqual({
      lines: null,
      new: true,
      path: 'a.ts',
      source: 'export const a = 1;\n',
    });
  });

  it('已跟踪但内容未变时返回空增量行', /** 空增量行让调用方跳过解析，避免重复诊断历史问题。 */ () => {
    const root = createTempDirectory('scope-request-same-');
    initRepository(root, { 'a.ts': 'export const a = 1;\n' });

    const request = webRequest(
      root,
      join(root, 'a.ts'),
      'export const a = 1;\n',
      new Set(['a.ts']),
    );

    expect(request.lines).toEqual([]);
    expect(request.new).toBe(false);
  });
});

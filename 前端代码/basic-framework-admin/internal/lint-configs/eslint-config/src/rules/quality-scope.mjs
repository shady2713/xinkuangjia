/** 管理仓库文件边界和相对 HEAD 的增量范围；Git 调用只读且不经过 Shell。 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import { diffLines } from 'diff';

const excludedNames = new Set([
  '.cache',
  '.git',
  '.pytest_cache',
  '.ruff_cache',
  '.venv',
  '.worktrees',
  '__pycache__',
  'build',
  'dist',
  'node_modules',
  'target',
  'vendor',
  'venv',
]);
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * 调用受控 Git 参数并限制时间与输出，错误保留为环境失败。
 * @param root - 仓库根目录。
 * @param args - 独立 Git 参数。
 * @returns 未解码的标准输出，供路径协议和历史源码分别处理编码。
 * @throws Git 失败或超时时抛出错误。
 */
export function gitBytes(root, ...args) {
  const result = spawnSync(
    'git',
    ['-C', root, '-c', 'core.fsmonitor=false', ...args],
    {
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANG: 'C' },
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      `Git 检查失败：${result.error?.message ?? result.stderr?.toString('utf8')}`,
    );
  return result.stdout;
}

/**
 * 严格解码 Git 路径与文本协议；历史源码的无效编码另由增量范围处理。
 * @param root - 仓库根目录。
 * @param args - 独立 Git 参数。
 * @returns UTF-8 正文。
 * @throws Git 调用或 UTF-8 解码失败时抛出错误。
 */
export function git(root, ...args) {
  return decoder.decode(gitBytes(root, ...args));
}

/**
 * 从工作目录向上寻找真实 Git 边界，兼容工作树的 .git 文件。
 * @param start - 查找起点。
 * @returns 仓库的绝对真实路径。
 * @throws 没有 Git 边界时要求显式指定全量根目录。
 */
export function repositoryRoot(start) {
  let current = realpathSync(start);
  while (!existsSync(resolve(current, '.git'))) {
    const parent = dirname(current);
    if (parent === current)
      throw new Error('增量检查需要 Git 仓库；全量检查请指定 --root 和 --all');
    current = parent;
  }
  return current;
}

/**
 * 判断仓库相对路径是否属于禁止扫描的依赖、生成物或冻结归档。
 * @param name - 使用正斜杠的相对路径。
 * @returns 是否必须排除。
 */
export function excluded(name) {
  return (
    name
      .split('/')
      .some(
        /** 目录级匹配避免误排同名前缀。 */ (part) => excludedNames.has(part),
      ) ||
    name === '.agents/notes/archived' ||
    name.startsWith('.agents/notes/archived/')
  );
}

/**
 * 解析真实路径并验证仓库边界，不允许符号链接绕过排除规则。
 * @param root - 仓库绝对路径。
 * @param name - 根目录相对路径或绝对路径。
 * @returns 通过校验的真实路径。
 * @throws 不存在、越界或指向排除目录时拒绝。
 */
export function safePath(root, name) {
  const result = realpathSync(resolve(root, name));
  const rel = relative(root, result);
  if (
    isAbsolute(rel) ||
    rel === '..' ||
    rel.startsWith(`..${sep}`) ||
    excluded(rel.split(sep).join('/'))
  ) {
    throw new Error(`路径越界或指向排除区域：${name}`);
  }
  return result;
}

/**
 * 严格读取有限大小的 UTF-8 文件，允许原有 BOM。
 * @param file - 已通过边界校验的文件。
 * @returns 解码后的正文。
 * @throws 文件过大或存在无效 UTF-8 时失败。
 */
export function readText(file) {
  if (statSync(file).size > 16 * 1024 * 1024)
    throw new Error(`文件超过 16 MiB：${file}`);
  return decoder.decode(readFileSync(file));
}

/**
 * 发现所选源码；Git 忽略生效，非 Git 全量目录不跟随链接。
 * @param root - 已解析的仓库或全量目录。
 * @param paths - 相对 root 的显式范围；空数组代表全部。
 * @param extensions - 支持的后缀集合。
 * @returns 去重排序后的真实文件路径。
 * @throws 显式目标不存在或越界时失败。
 */
export function discover(root, paths, extensions) {
  const targets = paths.map(
    /** 提前拒绝无效显式范围，避免零文件假成功。 */ (name) =>
      safePath(root, name),
  );
  const candidates = [];
  /**
   * 扫描普通目录，不沿符号链接或 Windows junction 进入其他位置。
   * @param directory - 当前遍历的真实目录。
   */
  function walk(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (
        item.isSymbolicLink() ||
        excluded(relative(root, path).split(sep).join('/'))
      )
        continue;
      if (item.isDirectory()) walk(path);
      else if (item.isFile()) candidates.push(path);
    }
  }
  if (existsSync(resolve(root, '.git'))) {
    for (const name of git(
      root,
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ).split('\0')) {
      if (name && !excluded(name) && existsSync(resolve(root, name)))
        candidates.push(resolve(root, name));
    }
  } else {
    walk(root);
  }
  const files = new Set();
  for (const candidate of candidates) {
    if (
      !extensions.has(extname(candidate).toLowerCase()) ||
      lstatSync(candidate).isSymbolicLink()
    )
      continue;
    const path = safePath(root, candidate);
    if (!statSync(path).isFile()) continue;
    if (
      targets.length === 0 ||
      targets.some(
        /** 目录范围按路径分隔符匹配，防止同名前缀混入。 */ (target) =>
          path === target || path.startsWith(target + sep),
      )
    )
      files.add(path);
  }
  return [...files].toSorted();
}

/**
 * 返回新正文受影响的行号，删除映射到邻接行以发现被移除的注释。
 * @param before - HEAD 原文。
 * @param after - 当前或编辑器提供的正文。
 * @returns 一基行号数组。
 * @throws 差异计算超过限制时失败，不忽略未完成的检查。
 */
export function changedLines(before, after) {
  /** 统一换行后保留实际物理行；文件末尾换行不构成额外声明。 */
  const normalize = (text) => text.replaceAll(/\r\n?/gu, '\n');
  const current = normalize(after);
  const parts = diffLines(normalize(before), current, {
    timeout: 2000,
    ignoreNewlineAtEof: true,
  });
  if (!parts) throw new Error('增量行比较超时，请缩小文件或使用 --all');
  const count = current
    ? current.split('\n').length - Number(current.endsWith('\n'))
    : 0;
  const lines = new Set();
  let line = 1;
  for (const part of parts) {
    if (part.removed) {
      if (count) lines.add(Math.min(line, count));
    } else {
      if (part.added)
        for (let offset = 0; offset < part.count; offset++)
          lines.add(line + offset);
      line += part.count;
    }
  }
  return [...lines].toSorted(
    /** 保持确定性诊断顺序。 */ (left, right) => left - right,
  );
}

/**
 * 选择可靠历史正文的增量范围；历史编码无效时完整检查当前文件。
 * @param before - Git 中的旧源码字节，不用于执行或推测其他编码。
 * @param after - 已通过严格 UTF-8 校验的当前源码。
 * @returns 可用增量行或全量标记；旧编码不能用于缩小检查范围。
 * @throws 有效基线的差异计算超限时抛出错误。
 */
export function baselineScope(before, after) {
  let text;
  try {
    text = decoder.decode(before);
  } catch (error) {
    if (error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
    // 不猜测历史编码，也不跳过声明；全量门禁覆盖修复后的所有当前声明。
    return { lines: null, new: true };
  }
  return { lines: changedLines(text, after), new: false };
}

/**
 * 为一次检查读取 HEAD 跟踪集合，既有历史文件只检查变化涉及的声明。
 * @param root - Git 仓库根目录。
 * @returns 已跟踪路径集合；新仓库返回空集合。
 * @throws 非 Git 根目录无法提供增量基线时失败。
 */
export function trackedFiles(root) {
  if (!existsSync(resolve(root, '.git')))
    throw new Error('增量检查需要 Git 根目录；非 Git 目录请使用 --all');
  return new Set(
    git(root, 'rev-parse', '--revs-only', 'HEAD').trim()
      ? git(root, 'ls-tree', '-r', '--name-only', '-z', 'HEAD')
          .split('\0')
          .filter(Boolean)
      : [],
  );
}

/**
 * 获取相对 HEAD 的工作区变化和未跟踪路径，新仓库包含暂存的新文件。
 * @param root - Git 仓库根目录。
 * @returns 使用正斜杠的变化路径集合。
 */
export function changedFiles(root) {
  const hasHead = git(root, 'rev-parse', '--revs-only', 'HEAD').trim();
  const committed = hasHead
    ? git(
        root,
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--name-only',
        '-z',
        'HEAD',
        '--',
      )
    : git(root, 'ls-files', '--cached', '-z');
  return new Set(
    (committed + git(root, 'ls-files', '--others', '--exclude-standard', '-z'))
      .split('\0')
      .filter(Boolean),
  );
}

/**
 * 将当前文件转为共用解析器请求，编辑器内存文本也参与相对 HEAD 的比较。
 * @param root - 仓库根目录。
 * @param file - 文件绝对路径。
 * @param source - 当前正文。
 * @param tracked - HEAD 跟踪集合；null 表示全量。
 * @returns 含真实相对路径、正文、增量行及新文件标记的请求。
 */
export function webRequest(root, file, source, tracked) {
  const name = relative(root, file).split(sep).join('/');
  const fresh = tracked === null || !tracked.has(name);
  return {
    path: name,
    source,
    ...(fresh
      ? { lines: null, new: true }
      : baselineScope(gitBytes(root, 'show', `HEAD:${name}`), source)),
  };
}

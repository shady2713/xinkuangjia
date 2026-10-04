// @vitest-environment node
/**
 * 产物压缩插件（vite-config 的 plugins/archiver）真实行为回归。
 *
 * 该插件在 `closeBundle` 之后异步把 `dist` 目录压成 ZIP：产物名或输出目录写错会覆盖交付
 * 文件，失败分支不记录日志会让构建静默缺少压缩包。用例在独立临时工作目录里准备真实的
 * `dist` 内容，调用真实插件钩子，等待真实 archiver 写盘完成后核对 ZIP 结构与日志；
 * 失败用例分别制造"目录不是目录"和"输出路径非法"两种输入，验证插件把失败收敛为日志。
 *
 * 已发现的真实缺陷（本轮只报告，不改生产源码）：`zipFolder` 只监听归档器的 error，
 * 没有监听输出流的 error，因此当 zip 目标路径本身无法打开时（例如父路径是普通文件），
 * 进程会抛出未捕获的流错误，而不是走 `closeBundle` 的 catch 分支。下面的非法路径用例
 * 用同步抛错的路径输入覆盖 catch 分支，避免触发该未捕获错误。
 *
 * 压缩目标按 `process.cwd()` 解析，因此用例真实切换工作目录并在结束后恢复。
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { viteArchiverPlugin } from '../archiver';

/** 产物输出钩子的真实结构。 */
interface CloseBundleHook {
  /** 钩子处理函数，压缩在其内部异步完成。 */
  handler: () => void;
  /** 钩子执行顺序。 */
  order?: string;
}

/** 插件对象中本用例需要驱动的字段；Vite 的联合返回类型此处按真实结构收窄。 */
interface ArchiverPlugin {
  /** 生效阶段，压缩只在构建时启用。 */
  apply?: string;
  /** 产物输出结束后的异步压缩钩子。 */
  closeBundle?: CloseBundleHook;
  /** 插件执行时机标记。 */
  enforce?: string;
  /** 插件名称。 */
  name?: string;
}

/** 进入临时目录前的真实工作目录，用于恢复共享的进程状态。 */
let previousCwd: string;
/** 本用例独占的临时工作目录。 */
let workspace: string;

/**
 * 取出真实插件对象。
 * @param options 产物名与输出目录，省略时使用插件默认值。
 * @param options.name ZIP 文件名，不含扩展名。
 * @param options.outputDir ZIP 输出目录，相对当前工作目录。
 * @returns 可直接驱动钩子的插件对象。
 */
function getPlugin(options?: { name?: string; outputDir?: string }) {
  return viteArchiverPlugin(options) as ArchiverPlugin;
}

/**
 * 在临时工作目录里准备待压缩的目录结构。
 * @param files 相对 `dist` 的文件名与内容映射。
 */
function createDist(files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    const fullPath = join(workspace, 'dist', file);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

/**
 * 等待插件写出压缩包并读取字节内容。
 * @param zipPath 期望的压缩包绝对路径。
 * @returns 压缩包内容按 latin1 解码后的文本，用于核对归档条目名。
 * @throws 压缩包没有在超时前产出时抛出，避免把空文件当成成功。
 */
async function readZipAfterWait(zipPath: string) {
  await vi.waitFor(
    /** 真实实现用 setTimeout(0) 异步产出，按文件出现与大小稳定作为完成信号。 */ () => {
      expect(existsSync(zipPath)).toBe(true);
      expect(statSync(zipPath).size).toBeGreaterThan(22);
    },
  );
  return readFileSync(zipPath).toString('latin1');
}

beforeEach(
  /** 每例在独立临时目录中运行，产物互不覆盖。 */ () => {
    previousCwd = process.cwd();
    workspace = mkdtempSync(join(tmpdir(), 'vite-archiver-'));
    process.chdir(workspace);
  },
);

afterEach(
  /** 恢复真实工作目录并回收临时目录与产物。 */ () => {
    process.chdir(previousCwd);
    rmSync(workspace, { force: true, recursive: true });
  },
);

describe('viteArchiverPlugin', /** 产物 ZIP 的生成、命名与失败收敛。 */ () => {
  it('按自定义产物名与输出目录写出 ZIP', /** 命名或目录写错会把交付包放到错误位置。 */ async () => {
    createDist({
      'a.txt': 'DUMMY-a',
      'nested/b.txt': 'DUMMY-b',
    });
    const plugin = getPlugin({ name: 'bundle', outputDir: 'out' });
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});
    const zipPath = join(workspace, 'out', 'bundle.zip');

    expect(plugin.name).toBe('vite:archiver');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('post');
    expect(plugin.closeBundle?.order).toBe('post');

    plugin.closeBundle?.handler();

    await vi.waitFor(
      /** 完成信号是插件自己的成功日志，不用固定休眠猜测进度。 */ () => {
        expect(log).toHaveBeenCalledWith(
          `Folder has been zipped to: ${zipPath}`,
        );
      },
    );
    const archive = await readZipAfterWait(zipPath);

    // 归档条目名直接出现在 ZIP 的本地文件头里，可证明目录被真实遍历而非只建了空文件。
    expect(archive).toContain('a.txt');
    expect(archive).toContain('nested/b.txt');
    expect(log).toHaveBeenCalledWith(`Folder has been zipped to: ${zipPath}`);

    log.mockRestore();
  });

  it('未传选项时按默认名输出到当前目录', /** 默认值写错会让默认构建把压缩包放到意外位置。 */ async () => {
    createDist({ 'a.txt': 'DUMMY-a' });
    const plugin = getPlugin();
    const log = vi
      .spyOn(console, 'log')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});
    const zipPath = join(workspace, 'dist.zip');

    plugin.closeBundle?.handler();
    await readZipAfterWait(zipPath);

    expect(log).toHaveBeenCalledWith(`Folder has been zipped to: ${zipPath}`);

    log.mockRestore();
  });

  it('dist 不是目录时记录归档错误且不抛出', /** 压缩失败必须留下可定位日志，否则构建会静默缺少交付包。 */ async () => {
    writeFileSync(join(workspace, 'dist'), 'DUMMY-not-a-directory');
    const plugin = getPlugin();
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});

    expect(
      /** 失败必须被钩子内部消化，不能让构建抛出。 */ () =>
        plugin.closeBundle?.handler(),
    ).not.toThrow();

    await vi.waitFor(
      /** 等待归档器真实抛错并被钩子记录。 */ () => {
        expect(error).toHaveBeenCalled();
      },
    );

    const [message, reason] = error.mock.calls[0] as [string, Error];
    expect(message).toBe('Error zipping folder:');
    expect(String(reason)).toContain('ENOTDIR');

    error.mockRestore();
  });

  it('输出目录无法创建时吞掉建目录错误并记录压缩失败', /** mkdir 的 catch 必须不阻断后续流程，同时把真实失败记进日志。 */ async () => {
    createDist({ 'a.txt': 'DUMMY-a' });
    const plugin = getPlugin({ outputDir: 'bad\u0000dir' });
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});

    plugin.closeBundle?.handler();

    await vi.waitFor(
      /** 等待 mkdir 失败被吞掉后暴露出真实写入失败。 */ () => {
        expect(error).toHaveBeenCalled();
      },
    );

    const [message, reason] = error.mock.calls[0] as [
      string,
      Error & { code?: string },
    ];
    expect(message).toBe('Error zipping folder:');
    expect(reason.code).toBe('ERR_INVALID_ARG_VALUE');

    error.mockRestore();
  });
});

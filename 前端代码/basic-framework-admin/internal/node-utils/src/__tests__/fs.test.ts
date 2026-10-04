// @vitest-environment node
/**
 * Node 构建工具的文件读写工具（node-utils 的 fs）真实行为回归。
 *
 * 这三个函数是质量脚本与构建工具落盘 JSON、占位文件和读取配置的统一入口：
 * 父目录未创建会让首次写出失败，失败分支若吞掉异常会让调用方把未落盘当成成功。
 * 用例在独立临时目录里读写真实文件系统，只断言真实文件内容与传播出来的错误，
 * 不替换 fs 模块。本文件是构建工具链代码，按仓库既有做法声明 Node 环境，
 * 不改动覆盖率配置。
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureFile, outputJSON, readJSON } from '../fs';

/** 本用例独占的临时工作目录，用例结束后整体删除。 */
let workspace: string;

beforeEach(
  /** 为每例建立独立临时目录，避免用例之间共享文件状态。 */ () => {
    workspace = mkdtempSync(join(tmpdir(), 'node-utils-fs-'));
  },
);

afterEach(
  /** 删除本用例的临时目录并恢复被替换的 console.error。 */ () => {
    vi.restoreAllMocks();
    rmSync(workspace, { force: true, recursive: true });
  },
);

describe('outputJSON 写出 JSON 文件', /** 质量脚本依赖该函数落盘报告，缩进与父目录创建都属于对外契约。 */ () => {
  it('递归创建缺失的父目录并按两空格缩进写入', /** 报告目录通常尚不存在，不创建会让首次写出直接失败。 */ async () => {
    const target = join(workspace, 'reports', 'nested', 'coverage.json');

    await outputJSON(target, { covered: 3, files: ['a.ts'] });

    expect(readFileSync(target, 'utf8')).toBe(
      '{\n  "covered": 3,\n  "files": [\n    "a.ts"\n  ]\n}',
    );
  });

  it('显式缩进参数覆盖默认值', /** 调用方按需产出紧凑文件，忽略该参数会让体积统计失真。 */ async () => {
    const target = join(workspace, 'compact.json');

    await outputJSON(target, { a: 1 }, 0);

    expect(readFileSync(target, 'utf8')).toBe('{"a":1}');
  });

  it('数据无法序列化时留痕并向调用方抛出原错误', /** 静默失败会让调用方把未落盘的报告当成已生成。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 屏蔽预期内的输出，只保留调用记录。 */ () => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      outputJSON(join(workspace, 'circular.json'), circular),
    ).rejects.toThrow(TypeError);
    expect(consoleError).toHaveBeenCalledWith(
      'Error writing JSON file:',
      expect.any(TypeError),
    );
  });
});

describe('ensureFile 建立占位文件', /** 占位文件用于把构建输出路径提前登记到版本库，重复调用不能清空已有内容。 */ () => {
  it('递归创建父目录并写出空文件', /** 目标目录不存在时仍要建立占位文件。 */ async () => {
    const target = join(workspace, 'keep', '.gitkeep');

    await ensureFile(target);

    expect(readFileSync(target, 'utf8')).toBe('');
  });

  it('文件已存在时保留原有内容', /** 追加模式必须不截断，否则占位文件会清掉真实产物。 */ async () => {
    const target = join(workspace, 'existing.txt');
    writeFileSync(target, '已有内容');

    await ensureFile(target);

    expect(readFileSync(target, 'utf8')).toBe('已有内容');
  });

  it('目标不可写时留痕并向调用方抛出原错误', /** 静默失败会让后续写出落到不存在的路径上。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 屏蔽预期内的输出，只保留调用记录。 */ () => {});
    const directoryAsFile = join(workspace, 'as-directory');
    mkdirSync(directoryAsFile);

    await expect(ensureFile(directoryAsFile)).rejects.toMatchObject({
      code: 'EISDIR',
    });
    expect(consoleError).toHaveBeenCalledWith(
      'Error ensuring file:',
      expect.any(Error),
    );
  });
});

describe('readJSON 读取 JSON 文件', /** 配置与清单读取依赖该函数返回真实解析结果。 */ () => {
  it('返回解析后的对象', /** 读取结果必须是解析后的值，而不是原始文本。 */ async () => {
    const target = join(workspace, 'package.json');
    writeFileSync(target, '{"name":"@vben/node-utils","version":"5.6.0"}');

    await expect(readJSON(target)).resolves.toEqual({
      name: '@vben/node-utils',
      version: '5.6.0',
    });
  });

  it('文件缺失时留痕并向调用方抛出原错误', /** 缺失配置必须显式失败，不能返回 undefined 让调用方继续运行。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 屏蔽预期内的输出，只保留调用记录。 */ () => {});
    const missing = join(workspace, 'missing.json');

    await expect(readJSON(missing)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(consoleError).toHaveBeenCalledWith(
      'Error reading JSON file:',
      expect.any(Error),
    );
  });

  it('内容不是合法 JSON 时留痕并抛出解析错误', /** 损坏的清单必须让调用方看到解析失败原因。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 屏蔽预期内的输出，只保留调用记录。 */ () => {});
    const target = join(workspace, 'broken.json');
    writeFileSync(target, '{"name":');

    await expect(readJSON(target)).rejects.toBeInstanceOf(SyntaxError);
    expect(consoleError).toHaveBeenCalledWith(
      'Error reading JSON file:',
      expect.any(SyntaxError),
    );
  });
});

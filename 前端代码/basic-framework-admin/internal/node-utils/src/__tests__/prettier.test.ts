/**
 * 单个文件格式化入口（node-utils 的 prettier.ts）真实读写契约回归。
 *
 * `prettierFormat` 是构建与交付脚本批量格式化源码的公共入口：它必须按项目 Prettier 配置
 * 生成新内容，只在内容变化时回写磁盘，并在无法推断解析器时如实抛出。用例在私有临时目录
 * 中创建真实文件，用文件内容与修改时间两个外部观察点断言回写与否。
 */
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prettierFormat } from '../prettier';

/** 记录固定历史时间，用于判断未格式化文件是否被真实回写。 */
const FIXED_TIME = new Date('2001-02-03T04:05:06.000Z');

describe('prettierFormat 单文件格式化', /** 该入口直接改写磁盘文件，回写条件写错会污染工作区或漏掉格式化。 */ () => {
  let workspace: string;

  beforeEach(
    /** 每例创建私有临时目录，避免与其它用例共享文件路径。 */ async () => {
      workspace = await mkdtemp(join(tmpdir(), 'prettier-format-'));
    },
  );
  afterEach(
    /** 删除本例临时目录，保留失败信息的同时不残留文件。 */ async () => {
      await rm(workspace, { force: true, recursive: true });
    },
  );

  it('格式化未格式化的源码并回写磁盘', /** 内容变化必须落盘，否则批量格式化对工作区无效果。 */ async () => {
    const file = join(workspace, 'unformatted.ts');
    await writeFile(file, 'const a=1\n', 'utf8');

    const output = await prettierFormat(file);

    expect(output).toBe('const a = 1;\n');
    expect(await readFile(file, 'utf8')).toBe('const a = 1;\n');
  });

  it('内容已符合格式时不回写磁盘', /** 无变化仍写入会改动修改时间并触发无意义的构建失效。 */ async () => {
    const file = join(workspace, 'formatted.ts');
    await writeFile(file, 'const a = 1;\n', 'utf8');
    await utimes(file, FIXED_TIME, FIXED_TIME);
    // 写入后重新读取基准值，避免直接拿预期时间比较造成的精度误判。
    const before = await stat(file);

    const output = await prettierFormat(file);

    const after = await stat(file);
    expect(output).toBe('const a = 1;\n');
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('无法推断解析器时抛出而不改写文件', /** 未知扩展名必须显式失败，不能静默返回原文或写入错误内容。 */ async () => {
    const file = join(workspace, 'notes.unknownx');
    await writeFile(file, 'hello', 'utf8');

    await expect(prettierFormat(file)).rejects.toThrow(
      'No parser and no file path given',
    );
    expect(await readFile(file, 'utf8')).toBe('hello');
  });

  it('文件不存在时抛出读取失败', /** 调用方依赖真实读取错误定位路径问题。 */ async () => {
    await expect(
      prettierFormat(join(workspace, 'missing.ts')),
    ).rejects.toThrow();
  });
});

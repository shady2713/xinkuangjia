// @vitest-environment node
/**
 * 构建环境变量加载（vite-config 的 utils/env）真实行为回归。
 *
 * 该模块按 `.env`、`.env.local`、`.env.<mode>`、`.env.<mode>.local` 的顺序合并键值，
 * 并把 VITE_BASE、VITE_INJECT_APP_LOADING、VITE_PORT 转成构建参数：顺序写错会让本地覆盖
 * 失效，解析规则写错会把注释或畸形行当成配置，默认值与转换口径写错会让端口或首屏动画
 * 静默取到错误值。用例在独立临时目录里写入真实的 `.env` 系列文件，断言合并结果与转换后
 * 的取值，并覆盖缺失文件、额外文件与各类畸形输入。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAndConvertEnv, loadEnv } from '../env';

/** 本用例独占的临时工作目录，用例结束后整体删除。 */
let root: string;

/**
 * 在临时目录里写入一个环境文件。
 * @param file 文件名，例如 `.env.local`。
 * @param content 文件正文，按原样写入。
 */
function writeEnvFile(file: string, content: string) {
  writeFileSync(join(root, file), content);
}

beforeEach(
  /** 每例使用独立目录，避免环境文件互相影响。 */ () => {
    root = mkdtempSync(join(tmpdir(), 'vite-env-'));
  },
);

afterEach(
  /** 回收本用例独占的临时目录。 */ () => {
    rmSync(root, { force: true, recursive: true });
  },
);

describe('loadEnv', /** 环境文件合并顺序与解析规则。 */ () => {
  it('按模式顺序合并，后者覆盖同名前值', /** 覆盖顺序写错会让本地或模式配置被默认值覆盖。 */ async () => {
    writeEnvFile(
      '.env',
      [
        '# 注释行不参与解析',
        '',
        '   ',
        'NO_SEPARATOR',
        '=LEADING_SEPARATOR',
        'DUP=from-env',
        'EMPTY=',
        'EQUALS=a=b',
        'QUOTED="双引号 值"',
        "SINGLE='单引号值'",
        'SPACED=   去空白   ',
      ].join('\n'),
    );
    writeEnvFile('.env.local', 'DUP=from-local\n');
    writeEnvFile('.env.test', 'DUP=from-mode\nMODE_ONLY=1\n');
    writeEnvFile('.env.test.local', 'DUP=from-mode-local\n');

    expect(await loadEnv(root, 'test')).toEqual({
      DUP: 'from-mode-local',
      EMPTY: '',
      EQUALS: 'a=b',
      MODE_ONLY: '1',
      QUOTED: '双引号 值',
      SINGLE: '单引号值',
      SPACED: '去空白',
    });
  });

  it('不传模式时只读取默认两层文件', /** 模式文件被误读会让不同构建共享同一份配置。 */ async () => {
    writeEnvFile('.env', 'BASE_ONLY=1\n');
    writeEnvFile('.env.local', 'LOCAL_ONLY=1\n');
    writeEnvFile('.env.test', 'MODE_ONLY=1\n');

    expect(await loadEnv(root)).toEqual({ BASE_ONLY: '1', LOCAL_ONLY: '1' });
  });

  it('额外文件最后合并且缺失文件直接跳过', /** 构建机注入的配置必须优先级最高，缺失路径不能报错。 */ async () => {
    writeEnvFile('.env', 'DUP=from-env\n');
    writeFileSync(join(root, 'extra.env'), 'DUP=from-extra\nEXTRA_ONLY=1\n');

    expect(
      await loadEnv(root, undefined, [
        join(root, 'extra.env'),
        join(root, 'missing.env'),
      ]),
    ).toEqual({ DUP: 'from-extra', EXTRA_ONLY: '1' });
  });

  it('目录不存在时返回空表', /** 没有环境文件是正常状态，不能抛错中断构建。 */ async () => {
    expect(await loadEnv(join(root, 'not-exists'), 'production')).toEqual({});
  });
});

describe('loadAndConvertEnv', /** 构建参数的类型转换与默认值口径。 */ () => {
  it('转换为构建参数并保留原始键', /** 转换后的键缺失或原始键丢失都会让调用方取不到配置。 */ async () => {
    writeEnvFile(
      '.env',
      'VITE_BASE=/admin/\nVITE_INJECT_APP_LOADING=true\nVITE_PORT=6100\n',
    );

    expect(await loadAndConvertEnv(root, 'production')).toEqual({
      VITE_BASE: '/admin/',
      VITE_INJECT_APP_LOADING: 'true',
      VITE_PORT: '6100',
      base: '/admin/',
      injectAppLoading: true,
      port: 6100,
    });
  });

  it('缺少变量时使用默认值', /** 默认值写错会让开发服务器端口或首屏动画行为变化。 */ async () => {
    expect(await loadAndConvertEnv(root)).toEqual({
      base: '/',
      injectAppLoading: false,
      port: 5173,
    });
  });

  it('非数字端口与非严格 true 都回落默认值', /** `Number(value) || fallback` 与严格比较是现网口径，必须显式锁定。 */ async () => {
    writeEnvFile('.env', 'VITE_INJECT_APP_LOADING=TRUE\nVITE_PORT=abc\n');

    const env = await loadAndConvertEnv(root);

    expect(env.injectAppLoading).toBe(false);
    expect(env.port).toBe(5173);
  });

  it('端口为 0 时仍回落默认端口', /** `Number('0')` 为假值，显式端口 0 无法表达，属既有口径。 */ async () => {
    writeEnvFile('.env', 'VITE_PORT=0\nVITE_BASE=\n');

    const env = await loadAndConvertEnv(root);

    expect(env.port).toBe(5173);
    // 空字符串不是 undefined，`??` 会原样保留。
    expect(env.base).toBe('');
  });
});

// @vitest-environment node
/**
 * 大仓根目录与包清单查询（node-utils 的 monorepo）真实行为回归。
 *
 * 这四个函数是构建工具、提交钩子与发布脚本定位工作区包的唯一入口：根目录找错会让
 * 包清单为空，包名匹配写错会让按名取包静默返回 undefined。用例在工作区根与
 * 独立临时目录上调用真实实现，读取真实 `pnpm-workspace.yaml` 与包清单，只替换
 * 不存在的锁文件场景，不替换 `@manypkg/get-packages` 或 `find-up`。
 * 本文件是构建工具链代码，按仓库既有做法声明 Node 环境，不改动覆盖率配置。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findMonorepoRoot,
  getPackage,
  getPackages,
  getPackagesSync,
} from '../monorepo';

/** 本用例独占的临时目录，用例结束后整体删除。 */
let workspace: string;

beforeEach(
  /** 为每例建立独立临时目录，用于模拟没有锁文件的工作目录。 */ () => {
    workspace = mkdtempSync(join(tmpdir(), 'node-utils-monorepo-'));
  },
);

afterEach(
  /** 删除本用例的临时目录，避免残留文件影响其它用例。 */ () => {
    rmSync(workspace, { force: true, recursive: true });
  },
);

describe('findMonorepoRoot 定位大仓根目录', /** 根目录是所有包清单查询的起点，找错会让后续脚本读到空清单。 */ () => {
  it('默认从当前工作目录向上找到锁文件所在目录', /** 在仓库内运行时，根目录必须就是当前工作目录本身。 */ () => {
    expect(findMonorepoRoot()).toBe(process.cwd());
  });

  it('显式传入目录时从该目录向上查找', /** 调用方传入应用目录时仍应得到同一个大仓根。 */ () => {
    expect(findMonorepoRoot(join(process.cwd(), 'apps', 'web-ele'))).toBe(
      process.cwd(),
    );
  });

  it('找不到锁文件时回退为当前目录占位', /** 当前实现用空路径的 dirname 兜底，返回相对路径而不是抛错。 */ () => {
    expect(findMonorepoRoot(workspace)).toBe('.');
  });
});

describe('getPackagesSync 同步读取包清单', /** 提交钩子等同步入口依赖该函数，读不到包会让检查范围为空。 */ () => {
  it('返回工作区内真实包并按包名可检索', /** 包清单必须来自真实工作区配置，而不是空集合。 */ () => {
    const result = getPackagesSync();
    const names = result.packages.map(
      /** 取出包名用于核对真实包是否被枚举。 */ (pkg) => pkg.packageJson.name,
    );

    expect(names).toContain('@vben/node-utils');
    expect(names).toContain('@vben/web-ele');
    expect(names.length).toBeGreaterThan(10);
  });
});

describe('getPackages 异步读取包清单', /** 异步入口必须与同步入口返回同一份工作区数据。 */ () => {
  it('与同步入口得到相同的包名集合', /** 两个入口口径漂移会让异步脚本漏掉部分包。 */ async () => {
    const asyncPackages = await getPackages();
    const asyncNames = asyncPackages.packages.map(
      /** 取出包名用于与同步入口比对。 */ (pkg) => pkg.packageJson.name,
    );
    const syncNames = getPackagesSync().packages.map(
      /** 取出包名用于与异步入口比对。 */ (pkg) => pkg.packageJson.name,
    );

    expect([...asyncNames].toSorted()).toEqual([...syncNames].toSorted());
  });
});

describe('getPackage 按名取包', /** 发布与依赖检查按包名定位目录，取错包会让检查落到其它工程。 */ () => {
  it('命中时返回该包及其真实目录', /** 返回值的目录必须指向工作区内实际包目录。 */ async () => {
    const pkg = await getPackage('@vben/node-utils');

    expect(pkg?.packageJson.name).toBe('@vben/node-utils');
    expect(pkg?.dir.endsWith(join('internal', 'node-utils'))).toBe(true);
  });

  it('包名不存在时返回 undefined', /** 缺失的包不能退化成任意包，调用方据此决定失败。 */ async () => {
    await expect(
      getPackage('@vben/not-exist-package'),
    ).resolves.toBeUndefined();
  });
});

// @vitest-environment node
/**
 * 本工程 ESLint 扁平配置装配的真实行为回归。
 *
 * `defineConfig` 是本仓库唯一的配置入口：它把 19 个分类配置、自定义依赖方向配置与调用方
 * 追加的配置合并成一维数组交给 ESLint。用例直接 import 配置模块并断言它真实导出的内容，
 * 不借助 ESLint 间接加载——经 ESLint 加载要走提交进仓库的 jiti 桩，会在同一进程内产生
 * 第二份脚本坐标并让整包覆盖率分母不可信。
 */
import { describe, expect, it } from 'vitest';

import { customConfig } from './custom-config';
import { defineConfig } from './index';

/** 扁平配置条目的最小结构：只声明断言真正读取的字段。 */
interface FlatConfigLike {
  files?: string[];
  ignores?: unknown;
  languageOptions?: { parser?: unknown };
  name?: string;
  plugins?: Record<string, unknown>;
  rules?: Record<string, unknown>;
}

/** 共享包反向依赖限制的规则选项结构。 */
interface RestrictionOptions {
  patterns?: { group?: string[] }[];
}

/** 调用方追加的配置，用于核对用户配置排在真实配置之后。 */
const APPENDED = {
  files: ['**/*.probe.ts'],
  rules: { 'no-console': 'error' as const },
};

/**
 * 取出装配结果里的真实条目。
 * @param configs `defineConfig` 的返回值。
 * @returns 按扁平配置最小结构描述的真实条目数组。
 */
async function assembled(configs?: Parameters<typeof defineConfig>[0]) {
  const result = await defineConfig(configs);
  return result as unknown as FlatConfigLike[];
}

/**
 * 装配结果的条目命中判定。
 * @param item 单个扁平配置条目。
 * @returns 命中时为真。
 */
type EntryPredicate = (item: FlatConfigLike) => boolean;

/**
 * 只在装配结果里查找满足条件的条目，避免依赖真实配置的具体排列顺序。
 * @param configs 装配结果。
 * @param predicate 命中判定。
 * @returns 首个命中的条目；没有命中时为 undefined。
 */
function find(configs: FlatConfigLike[], predicate: EntryPredicate) {
  return configs.find(
    /** 经一层包装调用，避免把判定函数直接当回调传入。 */ (item) =>
      predicate(item),
  );
}

/**
 * 取出条目声明的文件范围。
 * @param item 单个扁平配置条目。
 * @returns 文件范围数组；未声明时为默认空数组。
 */
function filesOf(item: FlatConfigLike): string[] {
  return Array.isArray(item.files) ? item.files : [];
}

describe('defineConfig 装配真实配置', /** 入口一旦漏装配某类规则，对应源码就没有任何门禁。 */ () => {
  it('合并全部分类配置并保留调用方追加项', /** 追加项必须压轴，否则用户配置会被框架配置覆盖。 */ async () => {
    const configs = await assembled([APPENDED]);

    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBeGreaterThan(20);
    expect(
      configs.every(
        /** 每个扁平配置条目都必须是对象，数组或空值说明装配过程出错。 */ (
          item,
        ) => item !== null && typeof item === 'object' && !Array.isArray(item),
      ),
    ).toBe(true);
    expect(configs.at(-1)).toEqual(APPENDED);
  });

  it('装配 JSON 系列文件的真实规则与解析器', /** jsonc 配置未生效会让 tsconfig、package.json 失去排序门禁。 */ async () => {
    const configs = await assembled();
    const json = find(
      configs,
      /** 按 jsonc 配置声明的文件范围定位条目。 */ (item) =>
        filesOf(item).includes('**/*.json') &&
        filesOf(item).includes('*.code-workspace'),
    );

    expect(json).toBeDefined();
    expect(json?.rules?.['jsonc/no-bigint-literals']).toBe('error');
    expect(json?.rules?.['jsonc/no-dupe-keys']).toBe('error');
    expect(json?.languageOptions?.parser).toBeTruthy();
    expect(json?.plugins?.jsonc).toBeTruthy();
  });

  it('装配 Vue 单文件组件配置', /** 漏装配 Vue 插件会让 SFC 完全不过门禁。 */ async () => {
    const configs = await assembled();
    const vue = find(
      configs,
      /** Vue 分类配置声明了 .vue 文件范围并挂载 vue 插件。 */ (item) =>
        filesOf(item).some(
          /** 允许 .vue 通配写法出现在文件数组里。 */ (pattern) =>
            pattern.includes('.vue'),
        ) && Boolean(item.plugins?.vue),
    );

    expect(vue).toBeDefined();
    expect(vue?.plugins?.vue).toBeTruthy();
  });

  it('装配测试文件的专用配置与清理类规则', /** 测试文件若不加豁免会把断言风格误报成门禁失败。 */ async () => {
    const configs = await assembled();
    const test = find(
      configs,
      /** 测试分类配置覆盖 __tests__ 与 *.test.* 两类路径并挂载 test 插件。 */ (
        item,
      ) =>
        filesOf(item).some(
          /** 只按真实文件范围匹配，不依赖规则名。 */ (pattern) =>
            pattern.includes('test') || pattern.includes('__tests__'),
        ) && Boolean(item.plugins?.test),
    );

    expect(test).toBeDefined();
    expect(test?.rules?.['test/no-only-tests']).toBe('error');
    const disabled = find(
      configs,
      /** 关闭类配置用 name 前缀自描述。 */ (item) =>
        typeof item.name === 'string' && item.name.startsWith('disables/'),
    );
    expect(disabled?.rules?.['@typescript-eslint/ban-ts-comment']).toBe('off');
  });

  it('装配禁用注释类规则', /** 无依据的 eslint-disable 必须由 eslint-comments 拦截。 */ async () => {
    const configs = await assembled();
    const comments = find(
      configs,
      /** eslint-comments 插件在装配结果里以插件键出现。 */ (item) =>
        Boolean(item.plugins?.['eslint-comments']),
    );

    expect(comments?.rules?.['eslint-comments/no-unlimited-disable']).toBe(
      'error',
    );
    expect(comments?.rules?.['eslint-comments/no-unused-enable']).toBe('error');
  });

  it('装配全局忽略清单', /** 忽略清单缺失会让构建产物被当成生产源码纳入检查。 */ async () => {
    const configs = await assembled();
    const ignores = find(
      configs,
      /** 全局忽略是唯一同时忽略 node_modules 与 coverage 的条目。 */ (item) =>
        Array.isArray(item.ignores) &&
        item.ignores.includes('**/node_modules') &&
        item.ignores.includes('**/coverage'),
    );

    expect(ignores).toBeDefined();
    expect(ignores?.ignores).toContain('**/dist');
    expect(ignores?.ignores).toContain('**/pnpm-lock.yaml');
  });

  it('装配共享包的反向依赖限制', /** 共享包依赖应用源码会破坏依赖方向，必须由真实配置拒绝。 */ async () => {
    const configs = await assembled();
    const shared = find(
      configs,
      /** 自定义配置里共享包的条目声明了 packages/utils 范围。 */ (item) =>
        filesOf(item).includes('packages/utils/**/**') &&
        Boolean(item.rules?.['no-restricted-imports']),
    );

    expect(shared).toBeDefined();
    const restriction = shared?.rules?.['no-restricted-imports'] as
      | [unknown, RestrictionOptions]
      | undefined;
    expect(restriction?.[0]).toBe('error');
    const groups = (restriction?.[1]?.patterns ?? []).map(
      /** 只取分组模式文本，便于核对两条真实限制。 */ (pattern) =>
        (pattern?.group ?? []).join(','),
    );
    expect(
      groups.some(
        /** 应用源码别名必须被拒绝。 */ (group) =>
          group.includes('@vben/web-ele'),
      ),
    ).toBe(true);
    expect(
      groups.some(
        /** 共享包之间不得互相依赖。 */ (group) => group.includes('@vben/*'),
      ),
    ).toBe(true);
  });

  it('自定义配置本身是被装配的真实数组', /** custom-config 若是空数组，依赖方向门禁会静默消失。 */ () => {
    expect(Array.isArray(customConfig)).toBe(true);
    expect(customConfig.length).toBeGreaterThan(0);
    expect(
      customConfig.some(
        /** 至少一条声明了共享包范围并带反向依赖限制。 */ (item) =>
          Array.isArray(item.files) &&
          item.files.includes('packages/utils/**/**') &&
          Boolean(item.rules?.['no-restricted-imports']),
      ),
    ).toBe(true);
  });
});

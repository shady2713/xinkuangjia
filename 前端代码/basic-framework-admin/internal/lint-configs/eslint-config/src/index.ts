/**
 * ESLint 配置入口：聚合各语言与工具链片段并导出 defineConfig。
 * 顺序固定为 vue、javascript、ignores、prettier、typescript 等二十余项，
 * 项目自定义片段与调用方追加的 config 排在最后，便于就近覆盖默认规则；
 * 本模块只做组装与扁平化，规则内容仍由各 configs 片段负责。
 */
import type { Linter } from 'eslint';

import {
  command,
  comments,
  disableds,
  ignores,
  importPluginConfig,
  javascript,
  jsdoc,
  jsonc,
  node,
  perfectionist,
  pnpm,
  prettier,
  regexp,
  test,
  turbo,
  typescript,
  unicorn,
  vue,
  yaml,
} from './configs';
import { customConfig } from './custom-config';

/** 单条 ESLint 扁平配置项，直接复用 Linter.Config。 */
type FlatConfig = Linter.Config;

/** 配置工厂的返回形态：单条、数组或它们的 Promise，由 defineConfig 统一展开。 */
type FlatConfigPromise =
  | FlatConfig
  | FlatConfig[]
  | Promise<FlatConfig>
  | Promise<FlatConfig[]>;

/**
 * 把内置片段与调用方追加的配置组装成一个扁平配置数组。
 * 片段之间按固定顺序排列，自定义片段与入参排在最后，便于就近覆盖默认规则。
 * @param config - 调用方追加的配置，排在内置片段之后；省略时只用内置片段。
 * @returns 展开并扁平化后的配置数组，可直接交给 ESLint。
 */
async function defineConfig(config: FlatConfig[] = []) {
  const configs: FlatConfigPromise[] = [
    vue(),
    javascript(),
    ignores(),
    prettier(),
    typescript(),
    jsonc(),
    disableds(),
    importPluginConfig(),
    node(),
    perfectionist(),
    comments(),
    jsdoc(),
    unicorn(),
    test(),
    regexp(),
    command(),
    turbo(),
    yaml(),
    pnpm(),
    ...customConfig,
    ...config,
  ];

  const resolved = await Promise.all(configs);

  return resolved.flat();
}

export { defineConfig };

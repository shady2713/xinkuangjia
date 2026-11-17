import type { Linter } from 'eslint';

import {
  command,
  comments,
  disableds,
  footguns,
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

type FlatConfig = Linter.Config;

type FlatConfigPromise =
  FlatConfig | FlatConfig[] | Promise<FlatConfig> | Promise<FlatConfig[]>;

/**
 * 组合本工程 ESLint 扁平配置，并允许调用方追加覆盖项。
 *
 * @param config 调用方追加的扁平配置。
 * @returns 合并后的扁平配置数组。
 */
async function defineConfig(config: FlatConfig[] = []) {
  const configs: FlatConfigPromise[] = [
    vue(),
    javascript(),
    ignores(),
    prettier(),
    typescript(),
    footguns(),
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

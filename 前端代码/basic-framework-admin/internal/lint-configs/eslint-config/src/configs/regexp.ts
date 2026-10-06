/**
 * 正则规则片段：接入 eslint-plugin-regexp 的推荐规则集。
 * 只注册 regexp 插件并注入其规则，不限定适用文件；
 * 需要放宽的条目由项目自定义配置在上层覆盖。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成正则相关的规则配置片段。
 * @returns 注册 eslint-plugin-regexp 并注入其 recommended 规则的配置数组；不限定适用文件。
 */
export async function regexp(): Promise<Linter.Config[]> {
  const [pluginRegexp] = await Promise.all([
    interopDefault(import('eslint-plugin-regexp')),
  ] as const);

  return [
    {
      plugins: {
        regexp: pluginRegexp,
      },
      rules: {
        ...pluginRegexp.configs.recommended.rules,
      },
    },
  ];
}

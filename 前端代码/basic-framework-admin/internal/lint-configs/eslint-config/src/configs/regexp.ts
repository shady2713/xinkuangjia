/**
 * 正则规则片段：接入 eslint-plugin-regexp 的推荐规则集。
 * 只注册 regexp 插件并注入其规则，不限定适用文件；
 * 需要放宽的条目由项目自定义配置在上层覆盖。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

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

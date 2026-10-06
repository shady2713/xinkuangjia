/**
 * eslint-comments 插件的规则配置：禁用无依据、重复或无限范围的注释指令，
 * 使被关闭的规则必须在代码评审中可解释。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 eslint-comments 的规则配置片段。
 * @returns 注册 eslint-comments 插件并开启其推荐规则的配置数组，
 *   用于要求每个禁用注释写明原因、禁止重复或无限范围。
 */
export async function comments(): Promise<Linter.Config[]> {
  const [pluginComments] = await Promise.all([
    // @ts-expect-error - no types
    interopDefault(import('eslint-plugin-eslint-comments')),
  ] as const);

  return [
    {
      plugins: {
        'eslint-comments': pluginComments,
      },
      rules: {
        'eslint-comments/no-aggregating-enable': 'error',
        'eslint-comments/no-duplicate-disable': 'error',
        'eslint-comments/no-unlimited-disable': 'error',
        'eslint-comments/no-unused-enable': 'error',
      },
    },
  ];
}

/**
 * JSDoc 校验层：接入 eslint-plugin-jsdoc，核对标签与签名是否自洽。
 * 规则全部为 warn 级，不阻断构建；中文职责说明由仓库自定义规则检查。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 JSDoc 标签校验的配置片段。
 * @returns 注册 eslint-plugin-jsdoc 并开启标签与签名自洽性检查（参数名、类型、返回说明等）
 *   的配置数组；全部为 warn 级，不阻断构建。
 */
export async function jsdoc(): Promise<Linter.Config[]> {
  const [pluginJsdoc] = await Promise.all([
    interopDefault(import('eslint-plugin-jsdoc')),
  ] as const);

  return [
    {
      plugins: {
        jsdoc: pluginJsdoc,
      },
      rules: {
        'jsdoc/check-access': 'warn',
        'jsdoc/check-param-names': 'warn',
        'jsdoc/check-property-names': 'warn',
        'jsdoc/check-types': 'warn',
        'jsdoc/empty-tags': 'warn',
        'jsdoc/implements-on-classes': 'warn',
        'jsdoc/no-defaults': 'warn',
        'jsdoc/no-multi-asterisks': 'warn',
        'jsdoc/require-param-name': 'warn',
        'jsdoc/require-property': 'warn',
        'jsdoc/require-property-description': 'warn',
        'jsdoc/require-property-name': 'warn',
        'jsdoc/require-returns-check': 'warn',
        'jsdoc/require-returns-description': 'warn',
        'jsdoc/require-yields-check': 'warn',
      },
    },
  ];
}

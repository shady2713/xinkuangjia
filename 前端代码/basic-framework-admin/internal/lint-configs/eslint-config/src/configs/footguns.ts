/** 为 Vue 产品代码补充脚枪门禁，仅禁止使用 @ts-nocheck。 */

import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 为 Vue 单文件启用 @ts-nocheck 禁令；不收紧已有的 @ts-ignore 或 @ts-expect-error。
 *
 * @returns 仅作用于 Vue 单文件的 ESLint 扁平配置。
 */
export async function footguns(): Promise<Linter.Config[]> {
  const pluginTs = await interopDefault(
    import('@typescript-eslint/eslint-plugin'),
  );

  return [
    {
      files: ['**/*.vue'],
      plugins: {
        '@typescript-eslint': pluginTs as never,
      },
      rules: {
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-check': false,
            'ts-expect-error': false,
            'ts-ignore': false,
            'ts-nocheck': true,
          },
        ],
      },
    },
  ];
}

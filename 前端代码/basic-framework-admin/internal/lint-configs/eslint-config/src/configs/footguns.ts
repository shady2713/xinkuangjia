/** 为 Vue 产品代码补充脚枪门禁，禁止 @ts-nocheck 并要求 @ts-ignore / @ts-expect-error 附带原因说明。 */

import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 为 Vue 单文件启用与 TypeScript 一致的指令约束：禁止 @ts-nocheck，且 @ts-ignore 与 @ts-expect-error 必须写明原因。
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
            'ts-expect-error': 'allow-with-description',
            'ts-ignore': 'allow-with-description',
            'ts-nocheck': true,
          },
        ],
      },
    },
  ];
}

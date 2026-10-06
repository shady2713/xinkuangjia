/**
 * 规则豁免清单：按文件类型关闭个别规则，而非整体放宽严格度。
 * 测试文件放开 ts 注释与 console，.d.ts 放开三斜线引用，js 不强制导出类型。
 */
import type { Linter } from 'eslint';

export async function disableds(): Promise<Linter.Config[]> {
  return [
    {
      files: ['**/__tests__/**/*.?([cm])[jt]s?(x)'],
      name: 'disables/test',
      rules: {
        '@typescript-eslint/ban-ts-comment': 'off',
        'no-console': 'off',
      },
    },
    {
      files: ['**/*.d.ts'],
      name: 'disables/dts',
      rules: {
        '@typescript-eslint/triple-slash-reference': 'off',
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      name: 'disables/js',
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off',
      },
    },
  ];
}

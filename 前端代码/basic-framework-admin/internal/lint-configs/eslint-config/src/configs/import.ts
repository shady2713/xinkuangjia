/**
 * 导入规范：接入 eslint-plugin-import-x，约束重复导入与类型导入写法。
 * 只管导入导出的形式，模块能否解析交给 TypeScript，本层不做路径校验。
 */
import type { Linter } from 'eslint';

import * as pluginImport from 'eslint-plugin-import-x';

export async function importPluginConfig(): Promise<Linter.Config[]> {
  return [
    {
      plugins: {
        // @ts-expect-error - This is a dynamic import
        import: pluginImport,
      },
      rules: {
        'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
        'import/first': 'error',
        'import/newline-after-import': 'error',
        'import/no-duplicates': 'error',
        'import/no-mutable-exports': 'error',
        'import/no-named-default': 'error',
        'import/no-self-import': 'error',
        'import/no-unresolved': 'off',
        'import/no-webpack-loader-syntax': 'error',
      },
    },
  ];
}

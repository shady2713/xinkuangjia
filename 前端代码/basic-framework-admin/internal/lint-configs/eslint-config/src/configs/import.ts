/**
 * 导入规范：接入 eslint-plugin-import-x，约束重复导入与类型导入写法。
 * 只管导入导出的形式，模块能否解析交给 TypeScript，本层不做路径校验。
 */
import type { Linter } from 'eslint';

import * as pluginImport from 'eslint-plugin-import-x';

/**
 * 生成导入导出的规范配置片段。
 * @returns 注册 eslint-plugin-import-x 并开启重复导入、导入位置与类型导入写法检查的配置数组；
 *   模块能否解析仍交给 TypeScript，本片段不做路径校验。
 */
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

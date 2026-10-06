/**
 * Node 规则层：接入 eslint-plugin-n，按 Node 20.12 约束脚本与工具代码。
 * 只对 scripts 与 internal 放宽 process 引用，构建依赖走白名单。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 Node 环境规则配置片段。
 * @returns 注册 eslint-plugin-n 并按 Node 20.12 约束语法与全局用法，
 *   构建期依赖（vite、vitest 等）走白名单，另对 scripts 与 internal 放开 process 全局引用。
 */
export async function node(): Promise<Linter.Config[]> {
  const pluginNode = await interopDefault(import('eslint-plugin-n'));

  return [
    {
      plugins: {
        n: pluginNode,
      },
      rules: {
        'n/handle-callback-err': ['error', '^(err|error)$'],
        'n/no-deprecated-api': 'error',
        'n/no-exports-assign': 'error',
        'n/no-extraneous-import': [
          'error',
          {
            allowModules: [
              'unbuild',
              '@vben/vite-config',
              'vitest',
              'vite',
              '@vue/test-utils',
              '@vben/tailwind-config',
              '@playwright/test',
            ],
          },
        ],
        'n/no-new-require': 'error',
        'n/no-path-concat': 'error',
        // 'n/no-unpublished-import': 'off',
        'n/no-unsupported-features/es-syntax': [
          'error',
          {
            ignores: [],
            version: '>=20.12.0',
          },
        ],
        'n/prefer-global/buffer': ['error', 'never'],
        // 'n/no-missing-import': 'off',
        'n/prefer-global/process': ['error', 'never'],
        'n/process-exit-as-throw': 'error',
      },
    },
    {
      files: [
        'scripts/**/*.?([cm])[jt]s?(x)',
        'internal/**/*.?([cm])[jt]s?(x)',
      ],
      rules: {
        'n/prefer-global/process': 'off',
      },
    },
  ];
}

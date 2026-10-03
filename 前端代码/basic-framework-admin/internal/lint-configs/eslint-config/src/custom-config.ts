/** 定义当前工作区的依赖方向及各类源码适用的 ESLint 规则。 */
import type { Linter } from 'eslint';

const restrictedImportIgnores = [
  '**/vite.config.mts',
  '**/tailwind.config.mjs',
  '**/postcss.config.mjs',
];

// #/ 属于应用源码；gitignore 风格匹配必须转义 #，否则它会被当作注释。
const applicationImportRestriction = {
  group: [String.raw`\#/**`, '@vben/web-ele', '@vben/web-ele/**'],
  message: '共享包不能依赖应用源码；请通过参数或共享契约由应用注入。',
};

const customConfig: Linter.Config[] = [
  // shadcn-ui 内部组件是自动生成的，不做太多限制
  {
    files: ['packages/@core/ui-kit/shadcn-ui/**/**'],
    rules: {
      'vue/require-default-prop': 'off',
    },
  },
  {
    files: [
      'apps/**/**',
      'packages/effects/**/**',
      'packages/utils/**/**',
      'packages/types/**/**',
      'packages/locales/**/**',
    ],
    ignores: restrictedImportIgnores,
    rules: {
      'perfectionist/sort-interfaces': 'off',
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    files: ['**/**.vue'],
    ignores: restrictedImportIgnores,
    rules: {
      'perfectionist/sort-objects': 'off',
    },
  },
  {
    files: ['packages/**/**'],
    ignores: restrictedImportIgnores,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [applicationImportRestriction],
        },
      ],
    },
  },
  {
    files: ['packages/@core/**/**'],
    ignores: restrictedImportIgnores,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            applicationImportRestriction,
            {
              group: ['@vben/*'],
              message:
                'The @core package cannot import the @vben package, please use the @core package itself',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/@core/base/**/**'],
    ignores: restrictedImportIgnores,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            applicationImportRestriction,
            {
              group: ['@vben/*', '@vben-core/*'],
              message:
                'The @vben-core/shared package cannot import the @vben package, please use the @core/shared package itself',
            },
          ],
        },
      ],
    },
  },

  {
    files: [
      'packages/types/**/**',
      'packages/utils/**/**',
      'packages/icons/**/**',
      'packages/constants/**/**',
      'packages/styles/**/**',
      'packages/stores/**/**',
      'packages/preferences/**/**',
      'packages/locales/**/**',
    ],
    ignores: restrictedImportIgnores,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            applicationImportRestriction,
            {
              group: ['@vben/*'],
              message:
                'The @vben package cannot be imported, please use the @core package itself',
            },
          ],
        },
      ],
    },
  },
  // 后端模拟代码，不需要太多规则
  {
    files: ['docs/**/**'],
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      'n/no-extraneous-import': 'off',
      'n/prefer-global/buffer': 'off',
      'n/prefer-global/process': 'off',
      'no-console': 'off',
      'unicorn/prefer-module': 'off',
    },
  },
  {
    files: ['**/**/playwright.config.ts'],
    rules: {
      'n/prefer-global/buffer': 'off',
      'n/prefer-global/process': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['internal/**/**', 'scripts/**/**'],
    rules: {
      'no-console': 'off',
    },
  },
];

export { customConfig };

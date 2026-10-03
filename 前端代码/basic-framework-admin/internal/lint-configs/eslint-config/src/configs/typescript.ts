/** TypeScript 与 Vue 脚本共享严格类型规则；仅独立脚本使用 TypeScript 顶层解析器。 */
import type { ESLint, Linter } from 'eslint';

import { interopDefault } from '../util';

/** 构建实际消费者使用的类型规则，Vue 继续保留 SFC 解析器。
 * @returns 覆盖脚本和 Vue 的规则，以及独立脚本的解析器配置。
 */
export async function typescript(): Promise<Linter.Config[]> {
  const [pluginTs, parserTs] = await Promise.all([
    interopDefault(import('@typescript-eslint/eslint-plugin')),
    interopDefault(import('@typescript-eslint/parser')),
  ] as const);

  return [
    {
      files: ['**/*.?([cm])[jt]s?(x)', '**/*.vue'],
      plugins: {
        // 插件声明支持 ESLint 9，但其规则类型仍含四个已废弃的 RuleContext 方法。
        // 仅在注册第三方规则的互操作边界桥接该类型差异；TS/Vue 真实消费反例验证实际执行。
        '@typescript-eslint': {
          meta: pluginTs.meta,
          rules: pluginTs.rules as unknown as ESLint.Plugin['rules'],
        },
      },
      rules: {
        ...pluginTs.configs['eslint-recommended']?.overrides?.[0]?.rules,
        ...pluginTs.configs.strict?.rules,
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-check': false,
            'ts-expect-error': 'allow-with-description',
            'ts-ignore': true,
            'ts-nocheck': true,
          },
        ],

        // '@typescript-eslint/consistent-type-definitions': ['warn', 'interface'],
        '@typescript-eslint/consistent-type-definitions': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-empty-function': [
          'error',
          {
            allow: ['arrowFunctions', 'functions', 'methods'],
          },
        ],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-namespace': 'off',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/no-unused-expressions': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
          },
        ],
        '@typescript-eslint/no-use-before-define': 'off',
        '@typescript-eslint/no-var-requires': 'error',
        'unused-imports/no-unused-vars': 'off',
      },
    },
    {
      files: ['**/*.?([cm])[jt]s?(x)'],
      languageOptions: {
        parser: parserTs,
        parserOptions: {
          createDefaultProgram: false,
          ecmaFeatures: {
            jsx: true,
          },
          ecmaVersion: 'latest',
          extraFileExtensions: ['.vue'],
          jsxPragma: 'React',
          project: './tsconfig.*.json',
          sourceType: 'module',
        },
      },
    },
  ];
}

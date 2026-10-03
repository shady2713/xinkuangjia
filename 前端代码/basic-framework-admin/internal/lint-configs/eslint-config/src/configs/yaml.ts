/** YAML 文件的 ESLint 扁平配置：语法类规则、缩进与引号风格，以及 pnpm-workspace.yaml 的键排序。 */

import type { ESLint, Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 YAML 文件的 ESLint 扁平配置。
 *
 * 对全部 .yml/.yaml 启用 yml 插件的语法与风格规则；pnpm-workspace.yaml 额外按包管理器的
 * 约定顺序排序键，避免多人协作时该文件产生无意义的格式冲突。
 *
 * @returns 作用于 YAML 文件本体与 pnpm-workspace.yaml 的配置数组
 */
export async function yaml(): Promise<Linter.Config[]> {
  const [pluginYaml, parserYaml] = await Promise.all([
    interopDefault(import('eslint-plugin-yml')),
    interopDefault(import('yaml-eslint-parser')),
  ] as const);

  return [
    {
      files: ['**/*.y?(a)ml'],
      plugins: {
        // eslint-plugin-yml 1.x 的类型把 eslintrc 时代的 configs 与 flat configs 混在同一个
        // 记录里，legacy 条目的 rules 仍是字符串，无法直接赋给 ESLint 9 的 Plugin['configs']。
        // 本配置只按名启用 yaml/* 规则，从不读取 pluginYaml.configs，因此这里只注册
        // meta 与 rules，跳过用不到且类型不兼容的 configs 字段。
        yaml: {
          meta: pluginYaml.meta,
          rules: pluginYaml.rules as ESLint.Plugin['rules'],
        },
      },
      languageOptions: {
        parser: parserYaml,
      },
      rules: {
        'style/spaced-comment': 'off',

        'yaml/block-mapping': 'error',
        'yaml/block-sequence': 'error',
        'yaml/no-empty-key': 'error',
        'yaml/no-empty-sequence-entry': 'error',
        'yaml/no-irregular-whitespace': 'error',
        'yaml/plain-scalar': 'error',

        'yaml/vue-custom-block/no-parsing-error': 'error',

        'yaml/block-mapping-question-indicator-newline': 'error',
        'yaml/block-sequence-hyphen-indicator-newline': 'error',
        'yaml/flow-mapping-curly-newline': 'error',
        'yaml/flow-mapping-curly-spacing': 'error',
        'yaml/flow-sequence-bracket-newline': 'error',
        'yaml/flow-sequence-bracket-spacing': 'error',
        'yaml/indent': ['error', 2],
        'yaml/key-spacing': 'error',
        'yaml/no-tab-indent': 'error',
        'yaml/quotes': [
          'error',
          {
            avoidEscape: true,
            prefer: 'single',
          },
        ],
        'yaml/spaced-comment': 'error',
      },
    },
    {
      files: ['pnpm-workspace.yaml'],
      rules: {
        'yaml/sort-keys': [
          'error',
          {
            order: [
              'packages',
              'overrides',
              'patchedDependencies',
              'hoistPattern',
              'catalog',
              'catalogs',

              'allowedDeprecatedVersions',
              'allowNonAppliedPatches',
              'configDependencies',
              'ignoredBuiltDependencies',
              'ignoredOptionalDependencies',
              'neverBuiltDependencies',
              'onlyBuiltDependencies',
              'onlyBuiltDependenciesFile',
              'packageExtensions',
              'peerDependencyRules',
              'supportedArchitectures',
            ],
            pathPattern: '^$',
          },
          {
            order: { type: 'asc' },
            pathPattern: '.*',
          },
        ],
      },
    },
  ];
}

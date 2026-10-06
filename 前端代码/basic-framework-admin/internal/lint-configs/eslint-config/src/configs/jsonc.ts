/**
 * JSON/JSONC 扁平配置工厂：解析 .json/.json5/.jsonc 并统一键与数组排序。
 * 覆盖 tsconfig、package.json 与 cspell 词表；catalog 约束归 pnpm.ts。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

/**
 * 生成 JSON/JSONC 文件的 ESLint 扁平配置。
 *
 * 覆盖 .json、.json5、.jsonc 与 .code-workspace：前三个交给 jsonc-eslint-parser 解析，
 * 并启用 jsonc 插件的规范类规则；后三类文件再叠加排序规则，保证 tsconfig 与 package.json
 * 的键顺序在各机器上保持一致。
 *
 * @returns 依次作用于 JSON 文件本体、package.json、cspell 词表与 tsconfig 的配置数组
 */
export async function jsonc(): Promise<Linter.Config[]> {
  const [pluginJsonc, parserJsonc] = await Promise.all([
    interopDefault(import('eslint-plugin-jsonc')),
    interopDefault(import('jsonc-eslint-parser')),
  ] as const);

  return [
    {
      files: ['**/*.json', '**/*.json5', '**/*.jsonc', '*.code-workspace'],
      languageOptions: {
        parser: parserJsonc,
      },
      plugins: {
        jsonc: pluginJsonc,
      },
      rules: {
        'jsonc/no-bigint-literals': 'error',
        'jsonc/no-binary-expression': 'error',
        'jsonc/no-binary-numeric-literals': 'error',
        'jsonc/no-dupe-keys': 'error',
        'jsonc/no-escape-sequence-in-identifier': 'error',
        'jsonc/no-floating-decimal': 'error',
        'jsonc/no-hexadecimal-numeric-literals': 'error',
        'jsonc/no-infinity': 'error',
        'jsonc/no-multi-str': 'error',
        'jsonc/no-nan': 'error',
        'jsonc/no-number-props': 'error',
        'jsonc/no-numeric-separators': 'error',
        'jsonc/no-octal': 'error',
        'jsonc/no-octal-escape': 'error',
        'jsonc/no-octal-numeric-literals': 'error',
        'jsonc/no-parenthesized': 'error',
        'jsonc/no-plus-sign': 'error',
        'jsonc/no-regexp-literals': 'error',
        'jsonc/no-sparse-arrays': 'error',
        'jsonc/no-template-literals': 'error',
        'jsonc/no-undefined-value': 'error',
        'jsonc/no-unicode-codepoint-escapes': 'error',
        'jsonc/no-useless-escape': 'error',
        'jsonc/space-unary-ops': 'error',
        'jsonc/valid-json-number': 'error',
        'jsonc/vue-custom-block/no-parsing-error': 'error',
      },
    },
    sortTsconfig(),
    sortPackageJson(),
    sortCspellJson(),
  ];
}

/**
 * package.json 的排序规则：顶层键按固定顺序排列，files 与 pnpm.neverBuiltDependencies 数组升序，
 * 依赖、overrides 与 exports 等子对象各自按键名升序。
 */
function sortPackageJson(): Linter.Config {
  return {
    files: ['**/package.json'],
    rules: {
      'jsonc/sort-array-values': [
        'error',
        {
          order: { type: 'asc' },
          pathPattern: '^files$|^pnpm.neverBuiltDependencies$',
        },
      ],
      'jsonc/sort-keys': [
        'error',
        {
          order: [
            'name',
            'version',
            'description',
            'private',
            'keywords',
            'homepage',
            'bugs',
            'repository',
            'license',
            'author',
            'contributors',
            'categories',
            'funding',
            'type',
            'scripts',
            'files',
            'sideEffects',
            'bin',
            'main',
            'module',
            'unpkg',
            'jsdelivr',
            'types',
            'typesVersions',
            'imports',
            'exports',
            'publishConfig',
            'icon',
            'activationEvents',
            'contributes',
            'peerDependencies',
            'peerDependenciesMeta',
            'dependencies',
            'optionalDependencies',
            'devDependencies',
            'engines',
            'packageManager',
            'pnpm',
            'overrides',
            'resolutions',
            'husky',
            'simple-git-hooks',
            'lint-staged',
            'eslintConfig',
          ],
          pathPattern: '^$',
        },
        {
          order: { type: 'asc' },
          pathPattern: '^(?:dev|peer|optional|bundled)?[Dd]ependencies(Meta)?$',
        },
        {
          order: { type: 'asc' },
          pathPattern: '^(?:resolutions|overrides|pnpm.overrides)$',
        },
        {
          order: ['types', 'import', 'require', 'default'],
          pathPattern: '^exports.*$',
        },
      ],
    },
  };
}

/**
 * cspell 词表文件的排序规则：words 与 ignorePaths 数组按升序排列，避免多人改动时反复冲突。
 */
function sortCspellJson(): Linter.Config {
  return {
    files: ['**/cspell.json', '**/.cspell.json'],
    rules: {
      'jsonc/sort-array-values': [
        'error',
        {
          order: { type: 'asc' },
          pathPattern: '^words$|^ignorePaths$',
        },
      ],
    },
  };
}

/**
 * tsconfig 的排序规则：顶层键按 extends、compilerOptions、references 等顺序，
 * compilerOptions 内部按 TypeScript 官方文档的分组顺序排列。
 */
function sortTsconfig(): Linter.Config {
  return {
    files: [
      '**/tsconfig.json',
      '**/tsconfig.*.json',
      'internal/tsconfig/*.json',
    ],
    rules: {
      'jsonc/sort-keys': [
        'error',
        {
          order: [
            'extends',
            'compilerOptions',
            'references',
            'files',
            'include',
            'exclude',
          ],
          pathPattern: '^$',
        },
        {
          order: [
            /* Projects */
            'incremental',
            'composite',
            'tsBuildInfoFile',
            'disableSourceOfProjectReferenceRedirect',
            'disableSolutionSearching',
            'disableReferencedProjectLoad',
            /* Language and Environment */
            'target',
            'jsx',
            'jsxFactory',
            'jsxFragmentFactory',
            'jsxImportSource',
            'lib',
            'moduleDetection',
            'noLib',
            'reactNamespace',
            'useDefineForClassFields',
            'emitDecoratorMetadata',
            'experimentalDecorators',
            /* Modules */
            'baseUrl',
            'rootDir',
            'rootDirs',
            'customConditions',
            'module',
            'moduleResolution',
            'moduleSuffixes',
            'noResolve',
            'paths',
            'resolveJsonModule',
            'resolvePackageJsonExports',
            'resolvePackageJsonImports',
            'typeRoots',
            'types',
            'allowArbitraryExtensions',
            'allowImportingTsExtensions',
            'allowUmdGlobalAccess',
            /* JavaScript Support */
            'allowJs',
            'checkJs',
            'maxNodeModuleJsDepth',
            /* Type Checking */
            'strict',
            'strictBindCallApply',
            'strictFunctionTypes',
            'strictNullChecks',
            'strictPropertyInitialization',
            'allowUnreachableCode',
            'allowUnusedLabels',
            'alwaysStrict',
            'exactOptionalPropertyTypes',
            'noFallthroughCasesInSwitch',
            'noImplicitAny',
            'noImplicitOverride',
            'noImplicitReturns',
            'noImplicitThis',
            'noPropertyAccessFromIndexSignature',
            'noUncheckedIndexedAccess',
            'noUnusedLocals',
            'noUnusedParameters',
            'useUnknownInCatchVariables',
            /* Emit */
            'declaration',
            'declarationDir',
            'declarationMap',
            'downlevelIteration',
            'emitBOM',
            'emitDeclarationOnly',
            'importHelpers',
            'importsNotUsedAsValues',
            'inlineSourceMap',
            'inlineSources',
            'mapRoot',
            'newLine',
            'noEmit',
            'noEmitHelpers',
            'noEmitOnError',
            'outDir',
            'outFile',
            'preserveConstEnums',
            'preserveValueImports',
            'removeComments',
            'sourceMap',
            'sourceRoot',
            'stripInternal',
            /* Interop Constraints */
            'allowSyntheticDefaultImports',
            'esModuleInterop',
            'forceConsistentCasingInFileNames',
            'isolatedModules',
            'preserveSymlinks',
            'verbatimModuleSyntax',
            /* Completeness */
            'skipDefaultLibCheck',
            'skipLibCheck',
          ],
          pathPattern: '^compilerOptions$',
        },
      ],
    },
  };
}

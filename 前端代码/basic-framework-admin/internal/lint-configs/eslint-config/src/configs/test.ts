/**
 * 测试规则片段：为 Vitest 用例文件注册校验规则。
 * 仅命中 __tests__、*.spec、*.test 等用例路径，放行 console 与 process，
 * 并借 no-only-tests 拦截误提交的 .only；跑测试本身不在此配置内。
 */
import type { Linter } from 'eslint';

import { interopDefault } from '../util';

export async function test(): Promise<Linter.Config[]> {
  const [pluginTest, pluginNoOnlyTests] = await Promise.all([
    interopDefault(import('eslint-plugin-vitest')),
    // @ts-expect-error - no types
    interopDefault(import('eslint-plugin-no-only-tests')),
  ] as const);

  return [
    {
      files: [
        `**/__tests__/**/*.?([cm])[jt]s?(x)`,
        `**/*.spec.?([cm])[jt]s?(x)`,
        `**/*.test.?([cm])[jt]s?(x)`,
        `**/*.bench.?([cm])[jt]s?(x)`,
        `**/*.benchmark.?([cm])[jt]s?(x)`,
      ],
      plugins: {
        test: {
          ...pluginTest,
          rules: {
            ...pluginTest.rules,
            ...pluginNoOnlyTests.rules,
          },
        },
      },
      rules: {
        'no-console': 'off',
        'node/prefer-global/process': 'off',
        'test/consistent-test-it': [
          'error',
          { fn: 'it', withinDescribe: 'it' },
        ],
        'test/no-identical-title': 'error',
        'test/no-import-node-test': 'error',
        'test/no-only-tests': 'error',
        'test/prefer-hooks-in-order': 'error',
        'test/prefer-lowercase-title': 'error',
      },
    },
  ];
}

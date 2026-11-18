/** 验证产品代码脚枪门禁：坏样本失败、好样本通过。 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import vueParser from 'vue-eslint-parser';

import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import pluginTest from 'eslint-plugin-vitest';

/**
 * 与产品配置一致的脚枪规则：禁 eval、new Function、document.write、空白 catch，
 * 以及产品代码中的 @ts-nocheck、无说明 @ts-ignore/@ts-expect-error 和被禁用的测试。
 */
const footgunRules = {
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-eval': 'error',
  'no-new-func': 'error',
  'no-restricted-properties': [
    'error',
    {
      message: '禁止使用 document.write，避免 DOM XSS 与文档流覆写。',
      object: 'document',
      property: 'write',
    },
    {
      message: '禁止使用 document.writeln，避免 DOM XSS 与文档流覆写。',
      object: 'document',
      property: 'writeln',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      message: '禁止使用 document.write，避免 DOM XSS 与文档流覆写。',
      selector:
        "CallExpression[callee.object.name='document'][callee.property.name='write']",
    },
    {
      message: '禁止使用 document.writeln，避免 DOM XSS 与文档流覆写。',
      selector:
        "CallExpression[callee.object.name='document'][callee.property.name='writeln']",
    },
  ],
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-check': false,
      'ts-expect-error': 'allow-with-description',
      'ts-ignore': 'allow-with-description',
      'ts-nocheck': true,
    },
  ],
};

/**
 * 用与产品门禁相同的规则检查一段源码。
 *
 * @param source 待检查源码。
 * @param extension 文件后缀，vue 时使用 Vue 解析器。
 * @returns ESLint 诊断列表。
 */
function lintFootguns(source, extension = 'ts') {
  const root = tmpdir();
  const isVue = extension === 'vue';
  return new Linter({ cwd: root }).verify(
    source,
    [
      {
        files: ['**/*.{js,ts,vue}'],
        plugins: { '@typescript-eslint': tsPlugin },
        languageOptions: {
          parser: isVue ? vueParser : tsParser,
          parserOptions: {
            parser: tsParser,
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
        },
        rules: footgunRules,
      },
    ],
    { filename: join(root, `脚枪样例.${extension}`) },
  );
}

/**
 * 判断诊断是否命中指定规则。
 *
 * @param messages ESLint 诊断列表。
 * @param rule 规则名。
 * @returns 是否存在该规则的错误级诊断。
 */
function hasRule(messages, rule) {
  return messages.some(
    /** 只把错误级诊断视为门禁失败。 */ (item) =>
      item.ruleId === rule && item.severity === 2,
  );
}

test('坏样本：eval、new Function 与 document.write 均失败', /** 确认三类动态执行脚枪会被阻断。 */ () => {
  const evalHits = lintFootguns('export const value = eval("1 + 1");\n');
  assert.ok(hasRule(evalHits, 'no-eval'), JSON.stringify(evalHits));

  const fnHits = lintFootguns('export const fn = new Function("return 1");\n');
  assert.ok(hasRule(fnHits, 'no-new-func'), JSON.stringify(fnHits));

  const writeHits = lintFootguns('document.write("<p>x</p>");\n');
  assert.ok(
    hasRule(writeHits, 'no-restricted-properties') ||
      hasRule(writeHits, 'no-restricted-syntax'),
    JSON.stringify(writeHits),
  );

  const writelnHits = lintFootguns('document.writeln("<p>x</p>");\n');
  assert.ok(
    hasRule(writelnHits, 'no-restricted-properties') ||
      hasRule(writelnHits, 'no-restricted-syntax'),
    JSON.stringify(writelnHits),
  );
});

test('好样本：不含动态执行脚枪的代码通过', /** 普通赋值和 DOM 读取不应被误报。 */ () => {
  const messages = lintFootguns(
    'export const value = 1;\nexport const title = document.title;\n',
  );
  assert.deepEqual(messages, []);
});

test('坏样本：产品代码中的 ts-nocheck 在 TypeScript 与 Vue 中失败', /** 关闭整文件检查必须被阻断。 */ () => {
  const nocheckHits = lintFootguns('// @ts-nocheck\nexport const value = 1;\n');
  assert.ok(
    hasRule(nocheckHits, '@typescript-eslint/ban-ts-comment'),
    JSON.stringify(nocheckHits),
  );

  const vueHits = lintFootguns(
    '<script setup lang="ts">\n// @ts-nocheck\nconst value = 1;\n</script>\n<template><div /></template>\n',
    'vue',
  );
  assert.ok(
    hasRule(vueHits, '@typescript-eslint/ban-ts-comment'),
    JSON.stringify(vueHits),
  );
});

test('好样本：带说明的 ts-expect-error 与无指令代码通过', /** 允许有说明的期望错误。 */ () => {
  const expected = lintFootguns(
    '// @ts-expect-error 第三方库缺少类型声明\nexport const value = 1;\n',
  );
  assert.ok(
    !hasRule(expected, '@typescript-eslint/ban-ts-comment'),
    JSON.stringify(expected),
  );

  const clean = lintFootguns('export const value = 1;\n');
  assert.deepEqual(clean, []);
});

test('坏样本：Vue 与 TS 中无说明的 ts-ignore 和空白 catch 必须失败', /** 阻断无理由抑制与静默吞异常。 */ () => {
  const bareVueIgnore = lintFootguns(
    '<script setup lang="ts">\n// @ts-ignore\nconst value = 1;\n</script>\n<template><div /></template>\n',
    'vue',
  );
  assert.ok(
    hasRule(bareVueIgnore, '@typescript-eslint/ban-ts-comment'),
    JSON.stringify(bareVueIgnore),
  );

  const explainedVueIgnore = lintFootguns(
    '<script setup lang="ts">\n// @ts-ignore 兼容浏览器前缀属性\nconst value = 1;\n</script>\n<template><div /></template>\n',
    'vue',
  );
  assert.ok(
    !hasRule(explainedVueIgnore, '@typescript-eslint/ban-ts-comment'),
    JSON.stringify(explainedVueIgnore),
  );

  const emptyCatch = lintFootguns(
    'export function run(fn: () => void) { try { fn(); } catch {} }\n',
  );
  assert.ok(hasRule(emptyCatch, 'no-empty'), JSON.stringify(emptyCatch));

  const commentedCatch = lintFootguns(
    'export function run(fn: () => void) { try { fn(); } catch { /* 忽略预期取消 */ } }\n',
  );
  assert.ok(
    !hasRule(commentedCatch, 'no-empty'),
    JSON.stringify(commentedCatch),
  );
});

test('坏样本：测试文件中残留的 skip 与被注释用例必须失败', /** 防止坏测试被静默跳过提交。 */ () => {
  const root = tmpdir();
  /**
   * 按测试文件规则校验源码片段。
   *
   * @param {string} source 待校验的测试代码文本
   * @returns {import('eslint').Linter.LintMessage[]} 命中的诊断消息列表
   */
  const verifyTest = (source) =>
    new Linter({ cwd: root }).verify(
      source,
      [
        {
          files: ['**/*.test.ts'],
          plugins: { test: pluginTest },
          languageOptions: {
            parser: tsParser,
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
          },
          rules: {
            'test/no-commented-out-tests': 'error',
            'test/no-disabled-tests': 'error',
          },
        },
      ],
      { filename: join(root, '样例.test.ts') },
    );

  assert.ok(
    hasRule(
      verifyTest("it.skip('跳过用例', () => {});\n"),
      'test/no-disabled-tests',
    ),
  );
  assert.ok(
    hasRule(
      verifyTest("// it('被注释掉的用例', () => {});\n"),
      'test/no-commented-out-tests',
    ),
  );
  assert.deepEqual(verifyTest("it('正常用例', () => {});\n"), []);
});

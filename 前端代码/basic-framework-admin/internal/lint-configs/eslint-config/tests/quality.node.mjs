/** 验证本工程 ESLint 接入、增量边界和原生 Mermaid 命令，不执行应用代码。 */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import vueParser from 'vue-eslint-parser';

import tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';

import plugin from '../src/rules/chinese-comments.mjs';
import {
  baselineScope,
  changedLines,
  readText,
} from '../src/rules/quality-scope.mjs';
import { checkWebFile } from '../src/rules/web-comments.mjs';

const frontend = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = join(frontend, 'scripts/check-quality.mjs');

test('历史编码无效时完整检查当前声明，合法历史仍按增量处理', /** 不把编码修复当成跳过整个文件的理由。 */ () => {
  const source =
    '/** 模块执行任务。 */\nconst marker = 1;\nfunction missing() {}\n';
  const fullScope = baselineScope(Buffer.from([255]), source);
  assert.deepEqual(fullScope, { lines: null, new: true });
  assert.ok(
    checkWebFile({ path: 'probe.js', source, ...fullScope }).some(
      /** 全量范围必须发现当前未注释函数。 */ (item) => item.rule === 'web-doc',
    ),
  );
  const incremental = baselineScope(Buffer.from(source), source);
  assert.deepEqual(incremental, { lines: [], new: false });
  assert.deepEqual(
    checkWebFile({ path: 'probe.js', source, ...incremental }),
    [],
  );
});

test('当前源码仍拒绝非 UTF-8，不沿用历史编码恢复策略', /** 只对历史基线扩大范围，当前输入继续失败关闭。 */ () => {
  const root = mkdtempSync(join(tmpdir(), 'framework-encoding-'));
  try {
    const file = join(root, 'probe.js');
    writeFileSync(file, Buffer.from([255]));
    assert.throws(/** 实际读取非法当前文件。 */ () => readText(file));
  } finally {
    // root 由本测试创建，删除仅限该临时资源目录。
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * 使用真实 ESLint 和 Vue/TS 解析器核验规则，临时目录仅用作诊断路径。
 * @param source - 输入源码。
 * @param extension - 文件后缀。
 * @returns ESLint 的实际诊断列表。
 */
function lint(source, extension = 'js') {
  const root = tmpdir();
  return new Linter({ cwd: root }).verify(
    source,
    [
      {
        files: ['**/*.{js,ts,vue}'],
        plugins: { weetion: plugin },
        languageOptions: {
          parser: extension === 'vue' ? vueParser : tsParser,
          parserOptions: {
            parser: tsParser,
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
        },
        settings: { weetionRoot: root },
        rules: { 'weetion/comments': ['error', 'all'] },
      },
    ],
    { filename: join(root, `示例.${extension}`) },
  );
}

/**
 * 执行本工程原生命令，限制超时和输出并保留实际退出码。
 * @param args - 已分离的命令参数。
 * @returns 子进程结果；异常由断言报告。
 */
function command(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
}

test('ESLint 接受完整公开契约并拒绝缺失的参数和返回说明', /** 核验真实规则消息，而非仅测试配置能加载。 */ () => {
  assert.deepEqual(
    lint(
      '/** 计算数量。\n * @param value - 输入数量。\n * @returns 累计数量。\n */\nexport function sum(value) { return value + 1; }',
    ),
    [],
  );
  const failures = lint(
    '/** 计算数量。 */\nexport function sum(value) { return value + 1; }',
  );
  assert.ok(
    failures.some(
      /** 参数说明缺失必须产生阻断级诊断。 */ (item) =>
        item.message.includes('web-param') && item.severity === 2,
    ),
  );
  assert.ok(
    failures.some(
      /** 返回值不能只由参数标签代替。 */ (item) =>
        item.message.includes('web-returns'),
    ),
  );
});

test('ESLint 的 Vue 诊断保留原组件行号', /** SFC 原文由同一注释规则分析。 */ () => {
  const messages = lint(
    '<template><div /></template>\n<script setup lang="ts">\n/** 展示数量。 */\nconst n = 1;\nfunction missing() {}\n</script>',
    'vue',
  );
  assert.ok(
    messages.some(
      /** 函数位于第五行，不能报告脚本块内偏移。 */ (item) =>
        item.line === 5 && item.message.includes('web-doc'),
    ),
  );
});

test('ESLint 检查纯模板组件的职责说明', /** 没有脚本也不能绕过组件职责说明。 */ () => {
  assert.ok(
    lint('<template><div /></template>', 'vue').some(
      /** 要求中文组件说明。 */ (item) =>
        item.message.includes('vue-component-doc'),
    ),
  );
  assert.deepEqual(
    lint('<!-- 展示静态提示。 -->\n<template><div /></template>', 'vue'),
    [],
  );
});

test('删除注释定位到相邻声明，CRLF 不产生全文件变化', /** 保留原有增量检查的重要边界。 */ () => {
  assert.deepEqual(
    changedLines(
      'const n = 1;\n// 执行任务。\nfunction run() {}\n',
      'const n = 1;\nfunction run() {}\n',
    ),
    [2],
  );
  assert.deepEqual(changedLines('const n = 1;\r\n', 'const n = 1;\n'), []);
  assert.deepEqual(changedLines('a\nb\nc\n', 'a\nx\nc\n'), [2]);
});

test('Mermaid 原生命令检查真实围栏并报告非法图表', /** 临时数据由测试拥有，结束后只清理本测试创建的目录。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'weetion-mermaid-'));
  try {
    writeFileSync(
      join(directory, '图.md'),
      '---\nnote: |\n  ```mermaid\n  bad\n  ```\n---\n```mermaid\nflowchart LR\nA --> B\n```\n```mermaid\nflowchart LR\nA --> [\n```',
      'utf8',
    );
    const result = command(['mermaid', '--root', directory, '--json']);
    assert.equal(result.status, 1, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.count, 2);
    assert.equal(output.findings.length, 1);
    assert.equal(output.findings[0].line, 12);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('全量 Web 命令可检查非 Git 目录，并拒绝增量模式', /** 环境失败和规则失败必须可区分。 */ () => {
  const directory = mkdtempSync(join(tmpdir(), 'weetion-web-'));
  try {
    writeFileSync(
      join(directory, '例.ts'),
      '/** 执行任务。 */\nexport function run(): void {}',
      'utf8',
    );
    const complete = command(['web', '--root', directory, '--all', '--json']);
    assert.equal(complete.status, 0, complete.stderr);
    assert.equal(JSON.parse(complete.stdout).count, 1);
    const incremental = command(['web', '--root', directory, '.']);
    assert.equal(incremental.status, 2);
    assert.match(incremental.stderr, /Git/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('原生命令拒绝未知选项和显式越界路径', /** 无效范围不能作为零项目检查成功。 */ () => {
  assert.equal(command(['web', '--typo']).status, 2);
  const directory = mkdtempSync(join(tmpdir(), 'weetion-scope-'));
  try {
    const result = command(['mermaid', '--root', directory, '..']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /越界/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** 本工程 ESLint 入口：沿用现有规则并检查改动声明的完整中文注释。 */
// @ts-check

import { fileURLToPath } from 'node:url';

import { defineConfig } from '@vben/eslint-config';

import { commentConfig } from './internal/lint-configs/eslint-config/src/rules/chinese-comments.mjs';

export default defineConfig([
  commentConfig(fileURLToPath(new URL('.', import.meta.url))),
]);

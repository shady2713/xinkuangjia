#!/usr/bin/env node

/** turbo-run 的 bin 入口：由 package.json 的 bin 字段调用，只加载 dist/index.mjs。 */
import('../dist/index.mjs');

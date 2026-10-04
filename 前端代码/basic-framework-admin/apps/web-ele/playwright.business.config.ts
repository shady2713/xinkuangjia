/**
 * 业务端到端配置：连接由 scripts/e2e/run_business_e2e.py 启动的真实后端与前端预览。
 *
 * 这里刻意不声明 webServer：缺少后端或预览时，用例必须以便携失败告终，
 * 而不是由配置静默跳过或用陈旧服务冒充本次环境。
 */
import process from 'node:process';

import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 15_000,
  },
  // 用例共享同一份种子数据，串行执行避免列表断言互相干扰。
  fullyParallel: false,
  // 失败痕迹写到调用方指定的目录：默认落在仓库内，隔离环境脚本会改用临时目录。
  outputDir: process.env.BF_E2E_OUTPUT_DIR ?? './test-results',
  reporter: [['list']],
  testDir: './e2e-business',
  // 业务规格使用 *.e2e.ts：Vitest 默认只收集 *.test.ts 与 *.spec.ts，这样既不改动
  // 单测门禁的收集范围，也不会让需要真实后端的用例被单测入口误加载。
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  use: {
    baseURL: process.env.BF_E2E_BASE_URL ?? 'http://127.0.0.1:4173/admin/',
    trace: 'retain-on-failure',
    viewport: { height: 900, width: 1440 },
  },
  workers: 1,
});

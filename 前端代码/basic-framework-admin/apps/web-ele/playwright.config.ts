/**
 * 端到端测试运行配置：约定 e2e 用例目录、预览服务地址与失败留痕策略。
 * 预览服务由 Playwright 自行拉起，监听 127.0.0.1 的 4173 端口；
 * 单元与组件测试不在本文件范围内，由 vitest 配置负责。
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  reporter: [['list']],
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173/admin/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm run preview --host 127.0.0.1 --port 4173',
    reuseExistingServer: false,
    timeout: 120_000,
    url: 'http://127.0.0.1:4173/admin/',
  },
});

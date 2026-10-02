import Vue from '@vitejs/plugin-vue';
import VueJsx from '@vitejs/plugin-vue-jsx';
import {
  configDefaults,
  coverageConfigDefaults,
  defineConfig,
} from 'vitest/config';

export default defineConfig({
  plugins: [Vue(), VueJsx()],
  test: {
    // 明确统计应用与共享包源码；失败时仍输出报告，但不改变真实测试退出码。
    coverage: {
      all: true,
      exclude: [...coverageConfigDefaults.exclude, '**/e2e/**', '**/*.d.ts'],
      include: [
        'apps/*/src/**/*.{ts,tsx,js,jsx,vue}',
        'packages/**/src/**/*.{ts,tsx,js,jsx,vue}',
      ],
      provider: 'v8',
      reportOnFailure: true,
      reporter: ['text-summary', 'json', 'html'],
      reportsDirectory: './coverage',
    },
    environment: 'happy-dom',
    exclude: [
      ...configDefaults.exclude,
      '**/e2e/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/node_modules/**',
      '**/{stylelint,eslint}.config.*',
      '.prettierrc.mjs',
    ],
  },
});

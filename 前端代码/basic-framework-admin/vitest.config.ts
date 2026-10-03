/** 统一单元测试与完整源码覆盖率采集，最终百分比由独立逐文件门禁裁决。 */
import Vue from '@vitejs/plugin-vue';
import VueJsx from '@vitejs/plugin-vue-jsx';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [Vue(), VueJsx()],
  test: {
    // Vitest 3.2 的 all 纳入未导入源码；专项收集与最终百分比验收使用不同入口。
    coverage: {
      all: true,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/e2e/**',
        '**/__tests__/**',
        '**/*.d.{ts,mts,cts}',
        '**/*{.,-}{test,spec,bench,benchmark}{,-d}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
      ],
      include: [
        'apps/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}',
        'packages/**/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}',
        'internal/**/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue}',
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

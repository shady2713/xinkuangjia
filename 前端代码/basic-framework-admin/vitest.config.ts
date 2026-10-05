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
      // v8 提供者用 V8 区间反查源码映射统计分母：SFC 的 setup 包装行与模板渲染函数声明行由
      // 编译器生成、映射里没有对应段，端点无法回查会让整个函数区间连同分支被静默丢弃，
      // 语句计数停在默认值 1，形成"全部命中、函数数为 0"的假通过。校准包装只把这类端点
      // 对齐到区间内最近的真实映射列，命中数与区间层级不变；换 istanbul 会让类型与桶文件
      // 因插桩后没有语句而从报告里整体消失，反而破坏报告完整性，故不采用。
      customProviderModule: './vitest.coverage-provider.mjs',
      provider: 'custom',
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

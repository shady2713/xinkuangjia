/** 校验 Tailwind PostCSS 配置插件的真实装载结果，以及生产环境才启用 cssnano 的裁剪契约。 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import postcssConfig from '../postcss.config';

/** 记录进程原有的 NODE_ENV，保证用例结束后恢复共享的进程级状态。 */
const originalNodeEnv = process.env.NODE_ENV;

/** 在隔离的模块图里按指定 NODE_ENV 重新装载配置，避免污染已导入的实例。 */
async function loadWithNodeEnv(nodeEnv: string) {
  process.env.NODE_ENV = nodeEnv;
  vi.resetModules();
  const reloaded = await import('../postcss.config');
  return reloaded.default;
}

describe('tailwind PostCSS 配置', /** 该配置决定样式压缩与兼容前缀，插件键写错只会在真实构建时暴露。 */ () => {
  afterEach(
    /** 恢复 NODE_ENV，防止后续用例误判生产分支。 */ () => {
      process.env.NODE_ENV = originalNodeEnv;
      vi.resetModules();
    },
  );

  it('开发与测试环境装载固定插件集合但不启用 cssnano', /** 非生产构建保留可读样式，压缩插件必须缺席。 */ () => {
    const plugins = postcssConfig.plugins;
    expect(Object.keys(plugins)).toEqual([
      'autoprefixer',
      'postcss-antd-fixes',
      'postcss-import',
      'postcss-preset-env',
      'tailwindcss',
      'tailwindcss/nesting',
    ]);
    expect('cssnano' in plugins).toBe(false);
  });

  it('antd 兼容插件只对 ant 与 el 前缀生效', /** 前缀列表决定第三方组件类名的修复范围，扩大或缩小都会影响真实样式。 */ () => {
    expect(postcssConfig.plugins['postcss-antd-fixes']).toEqual({
      prefixes: ['ant', 'el'],
    });
  });

  it('tailwindcss 插件引用共享 Tailwind 配置本体', /** 插件必须拿到同一份主题配置，否则页面类名会失去项目色板与暗色模式。 */ () => {
    const tailwind = postcssConfig.plugins.tailwindcss;
    expect(tailwind.config.darkMode).toBe('selector');
    // 主题色板允许函数形态，这里按对象形态比对共享色板的主色。
    expect(tailwind.config.theme?.extend?.colors).toMatchObject({
      primary: { DEFAULT: 'hsl(var(--primary))' },
    });
  });

  it('生产环境额外启用 cssnano 压缩', /** 生产分支是独立模块实例，用重载后的配置验证压缩插件确实被加入。 */ async () => {
    const production = await loadWithNodeEnv('production');
    expect(production.plugins.cssnano).toEqual({});
    expect(Object.keys(production.plugins)).toContain('autoprefixer');
  });

  it('非生产环境重载后仍不包含 cssnano', /** 负对照：证明上一用例的差异来自 NODE_ENV 分支而不是模块重载本身。 */ async () => {
    const development = await loadWithNodeEnv('development');
    expect('cssnano' in development.plugins).toBe(false);
  });
});

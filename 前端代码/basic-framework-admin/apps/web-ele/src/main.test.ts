/**
 * 应用入口（main.ts）启动编排的真实行为回归。
 *
 * 入口负责在页面渲染前完成运行时配置加载、偏好初始化、应用启动与全局 loading 清理：
 * 命名空间必须由应用命名空间、构建版本与环境三段拼成，启动必须使用同一命名空间，
 * 清理必须发生在启动之后。用例只替换外部边界（偏好模块、启动模块、loading 工具与
 * 运行时配置脚本），编排逻辑全部真实执行。
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

/** 启动编排各外部边界的记录型替身；调用顺序用于断言真实先后关系。 */
const spies = vi.hoisted(
  /** 建立跨用例共享的替身与调用顺序记录。 */
  () => ({
    bootstrap: vi.fn(),
    initPreferences: vi.fn(),
    order: [] as string[],
    unmountGlobalLoading: vi.fn(),
  }),
);

vi.hoisted(
  /**
   * 入口在模块加载期读取运行时配置并立即启动，必须在导入前建立替身。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_APP_AUTH_PAGE_LAYOUT: 'panel-right',
      VITE_APP_ENABLE_PREFERENCES: 'false',
      VITE_APP_GLOBAL_SEARCH_ENABLE: 'false',
      VITE_APP_NAMESPACE: 'entry-test',
      VITE_APP_THEME_BUILTIN_TYPE: 'default',
      VITE_APP_THEME_COLOR_PRIMARY: 'hsl(212 100% 45%)',
      VITE_APP_THEME_MODE: 'light',
      VITE_APP_THEME_TOGGLE_ENABLE: 'false',
      VITE_APP_TITLE: '入口测试平台',
    });
  },
);

vi.mock(
  '../docker/app.config.js',
  /** 运行时配置脚本由生产页面加载，测试进程不重复注入全局配置。 */ () => ({}),
);

vi.mock(
  '@vben/preferences',
  /** 只替换偏好初始化与覆盖声明入口，命名空间拼装逻辑保持真实。 */ () => ({
    /** 透传覆盖声明，便于断言入口真实读取了应用覆盖配置。 */
    defineOverridesPreferences: (value: unknown) => value,
    /** 记录偏好初始化参数。 */
    initPreferences: spies.initPreferences,
  }),
);

vi.mock(
  './bootstrap',
  /** 只替换应用启动边界，避免创建真实应用实例。 */ () => ({
    /** 记录启动命名空间。 */
    bootstrap: spies.bootstrap,
  }),
);

vi.mock(
  '@vben/utils',
  /** 只替换全局 loading 清理工具。 */ () => ({
    /** 记录清理调用时机。 */
    unmountGlobalLoading: spies.unmountGlobalLoading,
  }),
);

spies.initPreferences.mockImplementation(
  /** 记录偏好初始化的先后顺序。 */ async () => {
    spies.order.push('initPreferences');
  },
);
spies.bootstrap.mockImplementation(
  /** 记录应用启动的先后顺序。 */ async () => {
    spies.order.push('bootstrap');
  },
);
spies.unmountGlobalLoading.mockImplementation(
  /** 记录 loading 清理的先后顺序。 */ () => {
    spies.order.push('unmountGlobalLoading');
  },
);

describe('应用入口启动编排', /** 入口顺序写错会让偏好未初始化就渲染页面或残留全局 loading。 */ () => {
  afterAll(
    /** 恢复被替换的全局运行时配置。 */ () => {
      vi.unstubAllGlobals();
    },
  );

  it('按运行时配置完成偏好初始化、应用启动与 loading 清理', /** 命名空间或顺序错误会让不同环境共用状态、页面一直停在加载动画。 */ async () => {
    await import('./main');

    await vi.waitFor(
      /** 等待入口内部的异步编排全部结算。 */ () => {
        expect(spies.unmountGlobalLoading).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );

    const appVersion = import.meta.env.VITE_APP_VERSION;
    const namespace = `entry-test-${appVersion}-dev`;
    expect(spies.initPreferences).toHaveBeenCalledWith({
      namespace,
      overrides: expect.objectContaining({
        app: expect.objectContaining({ accessMode: 'backend' }),
      }),
    });
    expect(spies.bootstrap).toHaveBeenCalledWith(namespace);
    expect(spies.order).toEqual([
      'initPreferences',
      'bootstrap',
      'unmountGlobalLoading',
    ]);
  });
});

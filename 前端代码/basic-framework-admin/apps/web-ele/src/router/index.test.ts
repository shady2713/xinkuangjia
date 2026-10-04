/** 校验应用 Router 实例的滚动行为与路由重置契约，防止切换身份后遗留旧权限路由。 */
import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router';

import { describe, expect, it, vi } from 'vitest';

import { resetRoutes, router } from './index';

// 应用配置在模块导入期即被读取，必须在导入 Router 之前提供与 app.config.js 同形状的测试值。
vi.hoisted(
  /** 写入最小运行时配置，使 API 与偏好模块能在无浏览器环境完成导入。 */ () => {
    (
      globalThis as unknown as { _VBEN_ADMIN_PRO_APP_CONF_: unknown }
    )._VBEN_ADMIN_PRO_APP_CONF_ = {
      VITE_APP_CAPTCHA_ENABLE: 'false',
      VITE_APP_STORE_SECURE_KEY: 'DUMMY-store-key',
      VITE_GLOB_API_URL: 'https://example.test/admin-api',
      VITE_GLOB_AUTH_DINGDING_CLIENT_ID: '',
      VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
    };
  },
);

/** 读取 Router 实际注册的滚动行为；配置缺失时立即失败，避免断言落到 undefined 上。 */
function scrollBehavior() {
  const behavior = router.options.scrollBehavior;
  if (typeof behavior !== 'function') {
    throw new TypeError('Router 未注册 scrollBehavior');
  }
  return behavior;
}

/** 构造只含滚动判定所需字段的路由位置，聚焦 hash 与 path 两个被读取的属性。 */
function location(path: string, hash = ''): RouteLocationNormalized {
  return { hash, path } as RouteLocationNormalized;
}

/** 用例自有的命名探测路由，用于确认重置会移除动态新增记录。 */
const probeRoute: RouteRecordRaw = {
  component: { template: '<div />' },
  name: 'ResetProbeRoute',
  path: '/reset-probe',
};

describe('应用 Router 实例', /** 该实例承载全部静态与权限路由，滚动与重置行为直接影响用户可见结果。 */ () => {
  it('浏览器前进后退时恢复已保存的滚动位置', /** 保存位置存在时必须原样返回，否则返回列表会丢失阅读位置。 */ () => {
    const savedPosition = { left: 12, top: 340 };
    expect(
      scrollBehavior()(location('/list'), location('/'), savedPosition),
    ).toBe(savedPosition);
  });

  it('带锚点跳转时平滑滚动到对应元素', /** 目标 hash 必须交给浏览器平滑滚动，而不是回到页面顶部。 */ () => {
    expect(
      scrollBehavior()(location('/doc', '#install'), location('/'), null),
    ).toEqual({ behavior: 'smooth', el: '#install' });
  });

  it('无保存位置且无锚点时回到页面顶部', /** 普通跳转的兜底是左上角，缺失会让新页面停留在上一页的滚动位置。 */ () => {
    expect(scrollBehavior()(location('/other'), location('/'), null)).toEqual({
      left: 0,
      top: 0,
    });
  });

  it('重置路由会移除动态新增记录并恢复静态记录', /** 切换身份前必须清掉旧权限路由，同时保证静态入口仍可解析。 */ () => {
    const staticNames = router
      .getRoutes()
      .map(
        /** 只取路由名，未命名记录没有可恢复的标识。 */ (record) => record.name,
      )
      .filter(
        /** 未命名路由由安装者的移除句柄负责，这里不参与比对。 */ (name) =>
          name !== undefined,
      );

    router.addRoute(probeRoute);
    expect(router.hasRoute('ResetProbeRoute')).toBe(true);
    expect(router.resolve('/reset-probe').name).toBe('ResetProbeRoute');

    resetRoutes();

    expect(router.hasRoute('ResetProbeRoute')).toBe(false);
    expect(router.resolve('/reset-probe').name).toBe('FallbackNotFound');
    for (const name of staticNames) {
      expect(router.hasRoute(name)).toBe(true);
    }
    expect(router.resolve('/auth/login').name).toBe('Login');
  });

  it('环境变量要求 hash 模式时改用 hash 历史', /** 部署到不支持服务端重写的路径时必须走 hash 路由，两种历史的解析结果不同。 */ async () => {
    // 隔离真实路由模块，避免重载时把 routes/modules 下的测试模块再次注册成用例。
    vi.doMock(
      './routes',
      /** 用空路由表隔离真实模块图，避免重载时把测试模块注册成用例。 */ () => ({
        accessRoutes: [],
        coreRouteNames: [],
        routes: [],
      }),
    );
    vi.stubEnv('VITE_ROUTER_HISTORY', 'hash');
    vi.resetModules();
    try {
      const reloaded = await import('./index');
      const hashRouter = reloaded.router;
      expect(hashRouter.resolve('/auth/login').href).toBe('#/auth/login');
      expect(router.resolve('/auth/login').href).toBe('/auth/login');
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('./routes');
      vi.resetModules();
    }
  });

  it('重复重置保持幂等且不改变路由数量', /** 多次调用不能累积重复记录，否则每次重置都会放大路由表。 */ () => {
    resetRoutes();
    const first = router.getRoutes().length;
    resetRoutes();
    expect(router.getRoutes()).toHaveLength(first);
  });
});

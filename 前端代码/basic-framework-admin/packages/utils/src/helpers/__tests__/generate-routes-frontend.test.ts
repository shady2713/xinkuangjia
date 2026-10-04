import type { RouteRecordRaw } from 'vue-router';

import { describe, expect, it } from 'vitest';

import {
  generateRoutesByFrontend,
  hasAuthority,
} from '../generate-routes-frontend';

/** 业务页面组件替身：前端路由模式只透传组件引用，不关心组件实现。 */
const BILLING_PAGE = {
  name: 'BillingPage',
  /** 渲染空节点，用例只断言组件引用被原样保留。 */
  render: () => null,
};
/** 403 兜底组件替身，替换行为只关心“被替换成什么”，不关心组件如何加载。 */
const FORBIDDEN_COMPONENT = {
  name: 'ForbiddenPage',
  /** 渲染空节点，用例只断言替换后的组件引用。 */
  render: () => null,
};

/**
 * 取出路由表中指定位置的路由，缺失时直接失败。
 * @param routes 路由表。
 * @param index 目标下标。
 * @returns 该位置的路由记录。
 * @throws Error 下标越界时抛出，避免用例在空路由上静默通过。
 */
function routeAt(routes: RouteRecordRaw[], index: number): RouteRecordRaw {
  const route = routes[index];
  if (!route) {
    throw new Error(`路由表缺少下标 ${index}`);
  }
  return route;
}

// Mock 路由数据
const mockRoutes = [
  {
    meta: {
      authority: ['admin', 'user'],
      hideInMenu: false,
    },
    path: '/dashboard',
    children: [
      {
        path: '/dashboard/overview',
        meta: { authority: ['admin'], hideInMenu: false },
      },
      {
        path: '/dashboard/stats',
        meta: { authority: ['user'], hideInMenu: true },
      },
    ],
  },
  {
    meta: { authority: ['admin'], hideInMenu: false },
    path: '/settings',
  },
  {
    meta: { hideInMenu: false },
    path: '/profile',
  },
] as RouteRecordRaw[];

describe('hasAuthority', /** 角色判定：无权限元信息放行，元信息非法或角色不匹配时拒绝。 */ () => {
  it('should return true if there is no authority defined', /** 未声明权限元信息时放行。 */ () => {
    expect(hasAuthority(routeAt(mockRoutes, 2), ['admin'])).toBe(true);
  });

  it('should return true if the user has the required authority', /** 角色命中时必须放行。 */ () => {
    expect(hasAuthority(routeAt(mockRoutes, 0), ['admin'])).toBe(true);
  });

  it('should return false if the user does not have the required authority', /** 角色不匹配时必须拒绝。 */ () => {
    expect(hasAuthority(routeAt(mockRoutes, 1), ['user'])).toBe(false);
  });
});

describe('generateRoutesByFrontend', /** 前端方式生成路由：无权限节点被过滤，403 兜底按需替换组件。 */ () => {
  it('should handle routes without children', async () => {
    const generatedRoutes = await generateRoutesByFrontend(mockRoutes, [
      'user',
    ]);
    expect(generatedRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/profile', // This route has no children and should be included
        }),
      ]),
    );
  });

  it('should handle empty roles array', async () => {
    const generatedRoutes = await generateRoutesByFrontend(mockRoutes, []);
    expect(generatedRoutes).toEqual(
      expect.arrayContaining([
        // Only routes without authority should be included
        expect.objectContaining({
          path: '/profile',
        }),
      ]),
    );
    expect(generatedRoutes).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/dashboard',
        }),
        expect.objectContaining({
          path: '/settings',
        }),
      ]),
    );
  });

  it('should handle missing meta fields', async () => {
    const routesWithMissingMeta = [
      { path: '/path1' }, // No meta
      { meta: {}, path: '/path2' }, // Empty meta
      { meta: { authority: ['admin'] }, path: '/path3' }, // Only authority
    ];
    const generatedRoutes = await generateRoutesByFrontend(
      routesWithMissingMeta as RouteRecordRaw[],
      ['admin'],
    );
    expect(generatedRoutes).toEqual([
      { path: '/path1' },
      { meta: {}, path: '/path2' },
      { meta: { authority: ['admin'] }, path: '/path3' },
    ]);
  });

  it('replaces a forbidden component for routes visible in the menu', /** 菜单里可见但无权限的页面要落到 403，让用户知道该去申请权限。 */ async () => {
    const routes: RouteRecordRaw[] = [
      {
        component: BILLING_PAGE,
        meta: {
          authority: ['admin'],
          menuVisibleWithForbidden: true,
          title: '账单',
        },
        path: '/billing',
      },
    ];

    const generated = await generateRoutesByFrontend(
      routes,
      ['guest'],
      FORBIDDEN_COMPONENT,
    );

    expect(generated).toHaveLength(1);
    expect(generated[0]?.component).toBe(FORBIDDEN_COMPONENT);
  });

  it('keeps the original component for authorised routes', /** 有权限的路由不能被替换成 403。 */ async () => {
    const routes: RouteRecordRaw[] = [
      {
        component: BILLING_PAGE,
        meta: { authority: ['admin'], title: '账单' },
        path: '/billing',
      },
    ];

    const generated = await generateRoutesByFrontend(
      routes,
      ['admin'],
      FORBIDDEN_COMPONENT,
    );

    expect(generated[0]?.component).toBe(BILLING_PAGE);
  });
});

describe('hasAuthority with malformed meta', /** 权限元信息配置错误时必须拒绝访问，不能因真值判断被误放行。 */ () => {
  it('rejects a non-array authority value', /** 单个字符串会被 includes 误判为有权限。 */ () => {
    /** 权限元信息被配成字符串的历史数据，运行时值确实不是数组。 */
    const malformed = JSON.parse('{"meta":{"authority":"admin"},"path":"/x"}');

    expect(hasAuthority(malformed, ['admin'])).toBe(false);
  });

  it('rejects an authority list containing non-strings', /** 对象或数字不能当角色标识。 */ () => {
    /** 权限元信息里混入对象的脏数据。 */
    const malformed = JSON.parse(
      '{"meta":{"authority":[{"role":"admin"}]},"path":"/x"}',
    );

    expect(hasAuthority(malformed, ['admin'])).toBe(false);
  });
});

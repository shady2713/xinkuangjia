import type { RouteRecordRaw } from 'vue-router';

import { describe, expect, it } from 'vitest';

import {
  generateRoutesByFrontend,
  hasAuthority,
} from '../generate-routes-frontend';

/** 403 兜底组件标识，替换行为只关心"被替换成什么"，不关心组件如何加载。 */
const FORBIDDEN_COMPONENT = '/_core/fallback/forbidden.vue';

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
  it('should return true if there is no authority defined', () => {
    expect(hasAuthority(mockRoutes[2], ['admin'])).toBe(true);
  });

  it('should return true if the user has the required authority', () => {
    expect(hasAuthority(mockRoutes[0], ['admin'])).toBe(true);
  });

  it('should return false if the user does not have the required authority', () => {
    expect(hasAuthority(mockRoutes[1], ['user'])).toBe(false);
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
        component: 'system/billing',
        meta: {
          authority: ['admin'],
          menuVisibleWithForbidden: true,
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
        component: 'system/billing',
        meta: { authority: ['admin'] },
        path: '/billing',
      },
    ];

    const generated = await generateRoutesByFrontend(
      routes,
      ['admin'],
      FORBIDDEN_COMPONENT,
    );

    expect(generated[0]?.component).toBe('system/billing');
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

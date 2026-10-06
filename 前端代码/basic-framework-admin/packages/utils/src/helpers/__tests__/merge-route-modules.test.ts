/**
 * mergeRouteModules 的单元测试：锁定动态导入模块的 default 路由数组按声明顺序拼接。
 *
 * 覆盖多模块合并、空模块表和 default 为空数组三种输入；不涉及后端菜单转路由的
 * 排序与权限过滤，那些由 generate-routes-* 系列测试负责。
 */
import type { RouteRecordRaw } from 'vue-router';

import type { RouteModuleType } from '../merge-route-modules';

import { describe, expect, it } from 'vitest';

import { mergeRouteModules } from '../merge-route-modules';

describe('mergeRouteModules', () => {
  it('should merge route modules correctly', () => {
    const routeModules: Record<string, RouteModuleType> = {
      './dynamic-routes/about.ts': {
        default: [
          {
            component: () => Promise.resolve({ template: '<div>About</div>' }),
            name: 'About',
            path: '/about',
          },
        ],
      },
      './dynamic-routes/home.ts': {
        default: [
          {
            component: () => Promise.resolve({ template: '<div>Home</div>' }),
            name: 'Home',
            path: '/',
          },
        ],
      },
    };

    const expectedRoutes: RouteRecordRaw[] = [
      {
        component: expect.any(Function),
        name: 'About',
        path: '/about',
      },
      {
        component: expect.any(Function),
        name: 'Home',
        path: '/',
      },
    ];

    const mergedRoutes = mergeRouteModules(routeModules);
    expect(mergedRoutes).toEqual(expectedRoutes);
  });

  it('should handle empty modules', () => {
    const routeModules: Record<string, RouteModuleType> = {};
    const expectedRoutes: RouteRecordRaw[] = [];

    const mergedRoutes = mergeRouteModules(routeModules);
    expect(mergedRoutes).toEqual(expectedRoutes);
  });

  it('should handle modules with no default export', () => {
    const routeModules: Record<string, RouteModuleType> = {
      './dynamic-routes/empty.ts': {
        default: [],
      },
    };
    const expectedRoutes: RouteRecordRaw[] = [];

    const mergedRoutes = mergeRouteModules(routeModules);
    expect(mergedRoutes).toEqual(expectedRoutes);
  });
});

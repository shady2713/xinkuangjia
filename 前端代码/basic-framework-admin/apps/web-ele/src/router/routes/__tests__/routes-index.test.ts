/**
 * 动态路由表的真实行为回归。
 *
 * 该模块在加载期把 `modules/**` 下的路由声明、视图目录清单与核心路由拼装成应用路由表：
 * 权限路由必须来自真实模块目录、404 兜底必须排在最后、组件键必须去掉 `.vue` 后缀并
 * 排除 `modules` 目录（视图目录下的表单片段不是页面）、核心路由名必须递归收集完整。
 * 用例直接断言这些模块级推导结果，而不是只导入模块。
 */
import type { RouteRecordRaw } from 'vue-router';

import { describe, expect, it } from 'vitest';

import { coreRoutes, fallbackNotFoundRoute } from '../core';
import { accessRoutes, componentKeys, coreRouteNames, routes } from '../index';

/** 视图目录清单，作为组件键推导的独立对照来源。 */
const viewModules = import.meta.glob('../../../views/**/*.vue');

/** 模块目录清单，作为权限路由来源的独立对照来源。 */
const moduleFiles = import.meta.glob('../modules/**/*.ts', { eager: true });

/**
 * 递归收集路由树中的名称，作为核心路由名的独立对照实现。
 * @param list 待遍历的路由列表。
 * @returns 按遍历顺序收集到的全部名称。
 */
function collectNames(list: RouteRecordRaw[]): unknown[] {
  const names: unknown[] = [];
  for (const route of list) {
    names.push(route.name);
    if (route.children) {
      names.push(...collectNames(route.children));
    }
  }
  return names;
}

describe('动态路由表推导', /** 路由表拼装错误会让页面缺少入口或把兜底路由排到最前。 */ () => {
  it('路由列表由核心路由、外部路由与 404 兜底依次组成', /** 兜底路由不在最后会拦截正常页面。 */ () => {
    expect(routes).toEqual([...coreRoutes, fallbackNotFoundRoute]);
    expect(routes.at(-1)).toBe(fallbackNotFoundRoute);
    expect(routes).toHaveLength(coreRoutes.length + 1);
  });

  it('权限路由来自真实模块目录且不含测试文件', /** 测试文件被收进生产路由表会连同测试框架一起打包。 */ () => {
    const moduleKeys = Object.keys(moduleFiles);
    expect(moduleKeys.length).toBeGreaterThan(0);
    expect(moduleKeys).toContain('../modules/dashboard.ts');
    expect(
      moduleKeys.filter(
        /** 只关心声明文件里是否混入测试文件。 */ (key) =>
          key.includes('.test.') || key.includes('.spec.'),
      ),
    ).toEqual([]);

    expect(accessRoutes.length).toBeGreaterThan(0);
    expect(accessRoutes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Dashboard' })]),
    );
  });

  it('核心路由名递归收集完整', /** 少收集嵌套路由名会让权限判断漏掉子路由。 */ () => {
    expect(coreRouteNames).toEqual(collectNames(coreRoutes));
    // 404 兜底路由不属于核心路由名；守卫据此判断是否放行未知地址。
    expect(coreRouteNames).not.toContain(fallbackNotFoundRoute.name);
  });

  it('组件键去掉后缀且排除模块目录', /** 组件键带后缀或混入 modules 片段会让后端菜单解析不到页面组件。 */ () => {
    const expected = Object.keys(viewModules)
      .filter(
        /** 视图目录下的表单片段不属于可路由页面。 */ (item) =>
          !item.includes('/modules/'),
      )
      .map(
        /** 去掉视图前缀与 .vue 后缀，得到组件键。 */ (item) => {
          const path = item.replace('../../../views/', '/');
          return path.endsWith('.vue') ? path.slice(0, -4) : path;
        },
      );

    expect(componentKeys).toEqual(expected);
    expect(componentKeys.length).toBeGreaterThan(0);
    expect(componentKeys).toContain('/dashboard/analytics/index');
    expect(componentKeys).toContain('/_core/authentication/login');
    expect(
      componentKeys.filter(
        /** 组件键不应保留 .vue 后缀。 */ (key) => key.endsWith('.vue'),
      ),
    ).toEqual([]);
    expect(
      componentKeys.filter(
        /** 组件键不应混入 modules 目录片段。 */ (key) =>
          key.includes('/modules/'),
      ),
    ).toEqual([]);
    expect(
      componentKeys.filter(
        /** 组件键必须以根路径开头，后端菜单按该口径拼接。 */ (key) =>
          !key.startsWith('/'),
      ),
    ).toEqual([]);
  });
});

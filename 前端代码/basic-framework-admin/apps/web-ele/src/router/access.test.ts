/**
 * 验证静态业务子页权限校验与过滤逻辑，阻断后端路由模式下未授权用户直达隐藏页面。
 *
 * @author shady2713
 */
import type { RouteRecordRaw } from 'vue-router';

import { describe, expect, it, vi } from 'vitest';

import { filterAuthorizedStaticRoutes, hasRoutePermission } from './access';

/**
 * 构建用于测试的最小静态路由配置。
 *
 * @returns 模拟 `#/router/access` 所依赖的布局与页面组件映射模块
 */
function mockLayoutsModule() {
  return {
    BasicLayout: {},
    IFrameView: {},
  };
}

vi.mock('#/layouts', mockLayoutsModule);

/** 验证未声明权限约束或命中任一所需权限码时放行，缺失权限码时拒绝。 */
function evaluatesRequiredPermissionsCorrectly() {
  expect(hasRoutePermission(undefined, [])).toBe(true);
  expect(hasRoutePermission([], [])).toBe(true);
  expect(hasRoutePermission(['infra:job:query'], [])).toBe(false);
  expect(hasRoutePermission(['infra:job:query'], ['system:user:query'])).toBe(
    false,
  );
  expect(
    hasRoutePermission(
      ['infra:job:query'],
      ['system:user:query', 'infra:job:query'],
    ),
  ).toBe(true);
}

/** 验证静态路由与嵌套子路由会按权限码递归过滤，同时保留无约束页面。 */
function filtersStaticAndNestedRoutesByAccessCodes() {
  const routes: RouteRecordRaw[] = [
    {
      path: '/dashboard',
      name: 'Dashboard',
      meta: { title: '概览' },
      redirect: '/dashboard',
    },
    {
      path: '/infra/job/job-log',
      name: 'InfraJobLog',
      meta: {
        hideInMenu: true,
        requiredPermissions: ['infra:job:query'],
        title: '调度日志',
      },
      redirect: '/dashboard',
    },
    {
      path: '/infra',
      name: 'InfraGroup',
      meta: { title: '基础设施' },
      redirect: '/infra/job',
      children: [
        {
          path: 'job-log-child',
          name: 'InfraJobLogChild',
          meta: {
            requiredPermissions: ['infra:job:query'],
            title: '子日志',
          },
          redirect: '/dashboard',
        },
        {
          path: 'public-child',
          name: 'PublicChild',
          meta: { title: '公开页' },
          redirect: '/dashboard',
        },
      ],
    },
  ];

  const unauthorized = filterAuthorizedStaticRoutes(routes, [
    'system:user:query',
  ]);
  expect(unauthorized.map((item) => item.name)).toEqual([
    'Dashboard',
    'InfraGroup',
  ]);
  expect(unauthorized[1]?.children?.map((item) => item.name)).toEqual([
    'PublicChild',
  ]);

  const authorized = filterAuthorizedStaticRoutes(routes, ['infra:job:query']);
  expect(authorized.map((item) => item.name)).toEqual([
    'Dashboard',
    'InfraJobLog',
    'InfraGroup',
  ]);
  expect(authorized[2]?.children?.map((item) => item.name)).toEqual([
    'InfraJobLogChild',
    'PublicChild',
  ]);
}

/** 静态子页路由权限过滤测试套件。 */
function routeAccessSuite() {
  it(
    'evaluates requiredPermissions against user access codes',
    evaluatesRequiredPermissionsCorrectly,
  );
  it(
    'filters unauthorized static and nested routes by permission codes',
    filtersStaticAndNestedRoutesByAccessCodes,
  );
}

describe('router access permission helpers', routeAccessSuite);

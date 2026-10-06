/**
 * 路由聚合入口：汇总动态路由、核心路由与 404 兜底，供守卫与菜单模块取值。
 *
 * componentKeys 由 views 目录扫描生成，只供菜单选择组件；
 * 权限拦截与动态挂载由 router/guard 负责，这里不做判断。
 */
import type { RouteRecordRaw } from 'vue-router';

import { mergeRouteModules, traverseTreeValues } from '@vben/utils';

import { coreRoutes, fallbackNotFoundRoute } from './core';

/**
 * 动态路由模块表。
 *
 * 这里刻意排除 `*.test.ts` 与 `*.spec.ts`：该 glob 是 eager 且进入生产模块图，
 * 而仓库约定测试与被测源码同目录，测试文件一旦落在 `modules/` 下就会被一起打包
 * （实测曾把 vitest 与测试代码打进 `dist` 的生产 chunk）。
 */
const dynamicRouteFiles = import.meta.glob(
  ['./modules/**/*.ts', '!./modules/**/*.test.ts', '!./modules/**/*.spec.ts'],
  {
    eager: true,
  },
);

/** 动态路由 */
const dynamicRoutes: RouteRecordRaw[] = mergeRouteModules(dynamicRouteFiles);

/** 外部路由列表，访问这些页面可以不需要Layout，可能用于内嵌在别的系统(不会显示在菜单中) */
const staticRoutes: RouteRecordRaw[] = [];
const externalRoutes: RouteRecordRaw[] = [];

/** 路由列表，由基本路由、外部路由和404兜底路由组成
 *  无需走权限验证（会一直显示在菜单中） */
const routes: RouteRecordRaw[] = [
  ...coreRoutes,
  ...externalRoutes,
  fallbackNotFoundRoute,
];

/** 基本路由列表，这些路由不需要进入权限拦截 */
const coreRouteNames = traverseTreeValues(coreRoutes, (route) => route.name);

/** 有权限校验的路由列表，包含动态路由和静态路由 */
const accessRoutes = [...dynamicRoutes, ...staticRoutes];

// Adapted from an earlier internal implementation.
const componentKeys: string[] = Object.keys(
  import.meta.glob('../../views/**/*.vue'),
)
  .filter((item) => !item.includes('/modules/'))
  .map((v) => {
    const path = v.replace('../../views/', '/');
    return path.endsWith('.vue') ? path.slice(0, -4) : path;
  });
export { accessRoutes, componentKeys, coreRouteNames, routes };

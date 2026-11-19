/**
 * 路由权限生成与静态业务子页权限过滤工具。
 *
 * @author shady2713
 */
import type { RouteRecordRaw } from 'vue-router';

import type {
  AppRouteRecordRaw,
  ComponentRecordType,
  GenerateMenuAndRoutesOptions,
} from '@vben/types';

import { generateAccessible } from '@vben/access';
import { preferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';
import { convertServerMenuToRouteRecordStringComponent } from '@vben/utils';

import { BasicLayout, IFrameView } from '#/layouts';

/** 按需加载无权限 403 回退页。 */
const forbiddenComponent = () => import('#/views/_core/fallback/forbidden.vue');

/**
 * 校验当前权限码集合是否满足路由要求（任一权限码命中即放行）。
 *
 * @param requiredPermissions 路由声明的必需权限码列表
 * @param accessCodes 当前用户的权限码列表
 * @returns 未配置权限约束或命中任一权限码时返回 true
 */
export function hasRoutePermission(
  requiredPermissions: string[] | undefined,
  accessCodes: string[],
): boolean {
  if (!requiredPermissions || requiredPermissions.length === 0) {
    return true;
  }
  const codeSet = new Set(accessCodes);
  return requiredPermissions.some((code) => codeSet.has(code));
}

/**
 * 在注册静态业务子页路由前按权限码过滤，防止后端路由模式下无权限用户直达子页面。
 *
 * @param routes 静态路由列表
 * @param accessCodes 当前用户的权限码列表
 * @returns 过滤后的可访问静态路由树
 */
export function filterAuthorizedStaticRoutes(
  routes: RouteRecordRaw[],
  accessCodes: string[],
): RouteRecordRaw[] {
  const result: RouteRecordRaw[] = [];
  for (const route of routes) {
    if (!hasRoutePermission(route.meta?.requiredPermissions, accessCodes)) {
      continue;
    }
    if (Array.isArray(route.children) && route.children.length > 0) {
      result.push({
        ...route,
        children: filterAuthorizedStaticRoutes(route.children, accessCodes),
      });
    } else {
      result.push(route);
    }
  }
  return result;
}

/**
 * 按当前访问控制模式生成并注册可访问菜单与路由。
 *
 * @param options 路由与角色生成参数
 * @returns 生成后的可访问菜单与路由列表
 */
async function generateAccess(options: GenerateMenuAndRoutesOptions) {
  const pageMap: ComponentRecordType = import.meta.glob('../views/**/*.vue');
  const accessStore = useAccessStore();

  const layoutMap: ComponentRecordType = {
    BasicLayout,
    IFrameView,
  };

  const authorizedStaticRoutes = filterAuthorizedStaticRoutes(
    options.routes,
    accessStore.accessCodes,
  );

  return await generateAccessible(preferences.app.accessMode, {
    ...options,
    routes: authorizedStaticRoutes,
    fetchMenuListAsync: async () => {
      // 由于当前系统通过 accessStore 读取，因此不再进行 message.loading 提示
      // 补充说明：accessStore.accessMenus 一开始是 AppRouteRecordRaw 类型（后端加载），后面被赋值成 MenuRecordRaw 类型（前端转换）
      const accessMenus = accessStore.accessMenus as AppRouteRecordRaw[];
      return convertServerMenuToRouteRecordStringComponent(accessMenus);
    },
    // 可以指定没有权限跳转403页面
    forbiddenComponent,
    // 如果 route.meta.menuVisibleWithForbidden = true
    layoutMap,
    pageMap,
  });
}

export { generateAccess };

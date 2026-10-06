/**
 * 前端静态路由的权限生成：generateRoutesByFrontend 按角色过滤路由表，
 * 并在需要时把菜单可见但无权限的页面替换为传入的 403 组件，hasAuthority 是它的单节点判定。
 * 后端下发菜单的模式由 generate-routes-backend 承担，路由注册与跳转不在这里。
 */
import type { RouteRecordRaw } from 'vue-router';

import { filterTree, mapTree } from '@vben-core/shared/utils';

/**
 * 动态生成路由 - 前端方式
 */
async function generateRoutesByFrontend(
  routes: RouteRecordRaw[],
  roles: string[],
  forbiddenComponent?: RouteRecordRaw['component'],
): Promise<RouteRecordRaw[]> {
  // 根据角色标识过滤路由表,判断当前用户是否拥有指定权限
  const finalRoutes = filterTree(routes, (route) => {
    return hasAuthority(route, roles);
  });

  if (!forbiddenComponent) {
    return finalRoutes;
  }

  // 如果有禁止访问的页面，将禁止访问的页面替换为403页面
  return mapTree(finalRoutes, (route) => {
    if (menuHasVisibleWithForbidden(route)) {
      route.component = forbiddenComponent;
    }
    return route;
  });
}

/**
 * 判断路由是否有权限访问
 * @param route 具有可选角色元信息的路由。
 * @param access 当前身份已验证的角色列表。
 * @returns 是否满足角色条件；无效角色元信息拒绝访问。
 */
function hasAuthority(route: RouteRecordRaw, access: string[]) {
  const authority = route.meta?.authority;
  if (!authority) {
    return true;
  }
  // 权限元信息必须是字符串数组；错误配置不能因 truthy 值被误放行。
  if (
    !Array.isArray(authority) ||
    !authority.every(
      /** 逐项确认角色标识，不把对象或数字当成角色。 */ (role: unknown) =>
        typeof role === 'string',
    )
  )
    return false;
  // 命中任一角色标识即视为有权限；无权限但声明可见的路由在后面单独放行。
  const canAccess = access.some((value) => authority.includes(value));

  return canAccess || (!canAccess && menuHasVisibleWithForbidden(route));
}

/**
 * 判断路由是否在菜单中显示，但是访问会被重定向到403
 * @param route
 */
function menuHasVisibleWithForbidden(route: RouteRecordRaw) {
  return (
    !!route.meta?.authority &&
    Reflect.has(route.meta || {}, 'menuVisibleWithForbidden') &&
    !!route.meta?.menuVisibleWithForbidden
  );
}

export { generateRoutesByFrontend, hasAuthority };

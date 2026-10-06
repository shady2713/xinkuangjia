/** 权限路由生成与安装；动态记录按 Router 分配清理所有权。 */
import type { Component, DefineComponent } from 'vue';

import type {
  AccessModeType,
  GenerateMenuAndRoutesOptions,
  RouteRecordRaw,
} from '@vben/types';

import { defineComponent, h } from 'vue';

import {
  cloneDeep,
  generateMenus,
  generateRoutesByBackend,
  generateRoutesByFrontend,
  isFunction,
  isString,
  mapTree,
} from '@vben/utils';

/** 路由安装需要在异步生成完成后确认仍属于当前登录身份。 */
export type AccessibleOptions = {
  /** 返回 false 时丢弃本次生成，不移除或安装任何路由。 */
  isCurrent?: () => boolean;
} & GenerateMenuAndRoutesOptions;

/** Vue Router 返回的路由移除句柄。 */
type RemoveRoute = ReturnType<AccessibleOptions['router']['addRoute']>;

/** 每个 Router 独立持有本次安装的移除句柄，包含未命名及布局外路由。 */
const routeOwners = new WeakMap<AccessibleOptions['router'], RemoveRoute[]>();

/** 移除本模块安装的动态路由，保持静态根路由及其声明不变。
 * @param router 需要清理动态权限路由的 Router 实例。
 */
export function resetAccessibleRoutes(
  router: AccessibleOptions['router'],
): void {
  for (const remove of routeOwners.get(router) ?? []) remove();
  routeOwners.delete(router);
}

/** 生成并安装当前身份可访问路由，替换此前由本模块拥有的动态路由。
 * @param mode 权限来源模式。
 * @param options 路由来源、Router 及安装前的身份校验。
 * @returns 当前身份的菜单和路由；身份过期时返回空列表且不修改 Router。
 * @throws {Error} 动态路由名称重复或覆盖静态记录时拒绝安装。
 */
async function generateAccessible(
  mode: AccessModeType,
  options: AccessibleOptions,
) {
  const { router } = options;
  const accessibleRoutes = await generateRoutes(mode, {
    ...options,
    routes: cloneDeep(options.routes),
  });
  // 必须在首次 Router 写入前校验；守卫在 await 之后检查已不足以防止旧路由安装。
  if (options.isCurrent && !options.isCurrent()) {
    return { accessibleMenus: [], accessibleRoutes: [] };
  }
  resetAccessibleRoutes(router);
  const names = new Set<RouteRecordRaw['name']>();
  /** 在安装前拒绝覆盖静态入口或另一条权限记录的名称。
   * @param routes 本次权限路由树或递归子树。
   * @throws {Error} 路由名称已存在于静态记录或本次其他记录。
   */
  function validateNames(routes: RouteRecordRaw[]): void {
    for (const route of routes) {
      if (route.name) {
        if (router.hasRoute(route.name) || names.has(route.name)) {
          throw new Error(`权限路由名称与已有记录冲突：${String(route.name)}`);
        }
        names.add(route.name);
      }
      if (route.children) validateNames(route.children);
    }
  }
  validateNames(accessibleRoutes);
  const rootName = router
    .getRoutes()
    .find(
      /** 查找用于安装业务子路由的静态根。 */ (item) => item.path === '/',
    )?.name;
  const removers: RemoveRoute[] = [];
  routeOwners.set(router, removers);
  for (const route of accessibleRoutes) {
    if (rootName && !route.meta?.noBasicLayout) {
      // 为了兼容之前的版本用法，如果包含子路由，则将component移除，以免出现多层BasicLayout
      // 如果你的项目已经跟进了本次修改，移除了所有自定义菜单首级的BasicLayout，可以将这段if代码删除
      if (route.children && route.children.length > 0) {
        delete route.component;
      }
      // 使用 Router 的父路由 API，不把本次权限写回静态根记录的 children。
      removers.push(router.addRoute(rootName, route));
    } else {
      removers.push(router.addRoute(route));
    }
  }

  // 生成菜单
  const accessibleMenus = generateMenus(accessibleRoutes, options.router);

  return { accessibleMenus, accessibleRoutes };
}

/**
 * Generate routes
 * 按权限模式生成可访问路由：backend 取后端下发的菜单，frontend 按角色过滤本地路由表，
 * mixed 同时取两者并按「前端在前、后端在后」合并。生成结果还会补齐一级重定向，
 * 并把开启 keep-alive 的懒加载组件改包成与路由同名的组件。
 * @param mode 权限来源模式，决定路由由前端、后端还是两者共同生成。
 * @param options 生成路由所需的角色、待过滤路由表与无权限兜底组件。
 * @returns 可直接安装到 Router 的可访问路由树。
 */
async function generateRoutes(
  mode: AccessModeType,
  options: GenerateMenuAndRoutesOptions,
) {
  const { forbiddenComponent, roles, routes } = options;

  let resultRoutes: RouteRecordRaw[] = routes;
  switch (mode) {
    case 'backend': {
      resultRoutes = await generateRoutesByBackend(options);
      break;
    }
    case 'frontend': {
      resultRoutes = await generateRoutesByFrontend(
        routes,
        roles || [],
        forbiddenComponent,
      );
      break;
    }
    case 'mixed': {
      const [frontend_resultRoutes, backend_resultRoutes] = await Promise.all([
        generateRoutesByFrontend(routes, roles || [], forbiddenComponent),
        generateRoutesByBackend(options),
      ]);

      resultRoutes = [...frontend_resultRoutes, ...backend_resultRoutes];
      break;
    }
  }

  /**
   * 调整路由树，做以下处理：
   * 1. 对未添加redirect的路由添加redirect
   * 2. 将懒加载的组件名称修改为当前路由的名称（如果启用了keep-alive的话）
   */
  resultRoutes = mapTree(resultRoutes, (route) => {
    // 重新包装component，使用与路由名称相同的name以支持keep-alive的条件缓存。
    if (
      route.meta?.keepAlive &&
      isFunction(route.component) &&
      route.name &&
      isString(route.name)
    ) {
      const originalComponent =
        route.component as /* 断言为懒加载工厂：调用后返回含 default 的组件模块。 */ () => Promise<{
          default: Component | DefineComponent;
        }>;
      route.component = async () => {
        const component = await originalComponent();
        if (!component.default) return component;
        return defineComponent({
          name: route.name as string,
          /**
           * 用原组件重建一个与路由同名的包装组件，使 keep-alive 能按路由名命中缓存。
           * @param props 路由透传给页面的 props，原样转发给被包装组件。
           * @param context 组件上下文，attrs 与 props 合并转发，slots 原样透传。
           * @returns 渲染被包装组件的渲染函数。
           */
          setup(props, { attrs, slots }) {
            return () => h(component.default, { ...props, ...attrs }, slots);
          },
        });
      };
    }

    // 如果有redirect或者没有子路由，则直接返回
    if (route.redirect || !route.children || route.children.length === 0) {
      return route;
    }
    const firstChild = route.children[0];

    // 如果子路由不是以/开头，则直接返回,这种情况需要计算全部父级的path才能得出正确的path，这里不做处理
    if (!firstChild?.path || !firstChild.path.startsWith('/')) {
      return route;
    }

    route.redirect = firstChild.path;
    return route;
  });

  return resultRoutes;
}

export { generateAccessible };

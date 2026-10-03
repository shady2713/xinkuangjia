/** 将服务端路由描述显式转换为单视图路由，不将字符串组件断言为可运行组件。 */
import type { RouteRecordRaw } from 'vue-router';

import type {
  ComponentRecordType,
  GenerateMenuAndRoutesOptions,
  RouteRecordStringComponent,
} from '@vben-core/typings';

import { mapTree } from '@vben-core/shared/utils';

/**
 * 判断路由是否在菜单中显示但访问时展示 403（让用户知悉功能并申请权限）
 */
function menuHasVisibleWithForbidden(route: RouteRecordRaw): boolean {
  return !!route.meta?.menuVisibleWithForbidden;
}

/**
 * 动态生成路由 - 后端方式
 * 对 meta.menuVisibleWithForbidden 为 true 的项直接替换为 403 组件，让用户知悉功能并申请权限。
 */
async function generateRoutesByBackend(
  options: GenerateMenuAndRoutesOptions,
): Promise<RouteRecordRaw[]> {
  const {
    fetchMenuListAsync,
    layoutMap = {},
    pageMap = {},
    forbiddenComponent,
  } = options;

  try {
    const menuRoutes = await fetchMenuListAsync?.();
    if (!menuRoutes) {
      return [];
    }

    const normalizePageMap: ComponentRecordType = {};

    for (const [key, value] of Object.entries(pageMap)) {
      normalizePageMap[normalizeViewPath(key)] = value;
    }

    let routes = convertRoutes(menuRoutes, layoutMap, normalizePageMap);

    if (forbiddenComponent) {
      routes = mapTree(routes, (route) => {
        if (menuHasVisibleWithForbidden(route)) {
          route.component = forbiddenComponent;
        }
        return route;
      });
    }

    // 合并静态路由和动态路由
    return [...options.routes, ...routes];
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/** 递归创建新的路由记录，组件标识只有查表成功后才能进入 Router。
 * @param routes 后端路由描述集合。
 * @param layoutMap 可用布局的懒加载映射。
 * @param pageMap 归一化后的页面懒加载映射。
 * @returns 包含实际组件加载器的全新路由树，不修改输入数据。
 * @throws {Error} 页面不存在且没有配置兜底页面时停止生成。
 */
function convertRoutes(
  routes: RouteRecordStringComponent[],
  layoutMap: ComponentRecordType,
  pageMap: ComponentRecordType,
): RouteRecordRaw[] {
  return routes.map(
    /** 分离传输标识与运行时组件，并对后代执行同样的转换。
     * @param node 单个后端路由描述。
     * @returns Router 可以安装的新路由记录。
     * @throws {Error} 页面标识不能解析且未配置兜底页。
     */ (node): RouteRecordRaw => {
      const { component, children, ...fields } = node;
      let resolvedComponent = Object.hasOwn(layoutMap, component)
        ? layoutMap[component]
        : undefined;
      if (component && !resolvedComponent) {
        const normalizedPath = normalizeViewPath(component);
        const pageKey = normalizedPath.endsWith('.vue')
          ? normalizedPath
          : `${normalizedPath}.vue`;
        resolvedComponent =
          pageMap[pageKey] ?? pageMap['/_core/fallback/not-found.vue'];
        if (!resolvedComponent)
          throw new Error(`路由页面及兜底页面不存在：${pageKey}`);
      }
      return {
        ...fields,
        component: resolvedComponent,
        children: convertRoutes(children ?? [], layoutMap, pageMap),
      };
    },
  );
}

/** 将构建扫描键及后端页面标识统一成以斜杠开始的视图路径。 */
function normalizeViewPath(path: string): string {
  // 去除相对路径前缀
  const normalizedPath = path.replace(/^(\.\/|\.\.\/)+/, '');

  // 确保路径以 '/' 开头
  const viewPath = normalizedPath.startsWith('/')
    ? normalizedPath
    : `/${normalizedPath}`;

  return viewPath.replace(/^\/views/, '');
}
export { generateRoutesByBackend };

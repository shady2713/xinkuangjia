/** 将已解析路由生成展示菜单，并将经过校验的服务端菜单转换为路由描述。 */
import type { Router, RouteRecordRaw } from 'vue-router';

import type {
  AppRouteRecordRaw,
  MenuRecordRaw,
  RouteMeta,
  RouteRecordStringComponent,
} from '@vben-core/typings';

import { isHttpUrl } from '@vben-core/shared/utils';

/**
 * 根据 routes 生成菜单列表
 * @param routes - 路由配置列表
 * @param router - Vue Router 实例
 * @returns 生成的菜单列表
 */
function generateMenus(
  routes: RouteRecordRaw[],
  router: Router,
): MenuRecordRaw[] {
  const finalRoutesMap = new Map<RouteRecordRaw['name'], string>();
  for (const route of router.getRoutes()) {
    if (route.name !== undefined) finalRoutesMap.set(route.name, route.path);
  }

  /** 从路由树构建独立菜单树，子节点先转换再赋给展示模型。
   * @param records 当前层级的实际路由。
   * @param parents 当前层级祖先的完整路径。
   * @returns 按顺序排列且移除隐藏项的展示菜单，不改写原路由的 children。
   */
  function visit(
    records: RouteRecordRaw[],
    parents: string[],
  ): MenuRecordRaw[] {
    const menus: MenuRecordRaw[] = [];
    for (const route of records) {
      const path = finalRoutesMap.get(route.name) ?? route.path;
      const { name: routeName, redirect } = route;
      const meta: Partial<RouteMeta> = route.meta ?? {};
      if (meta.hideInMenu) continue;
      const {
        activeIcon,
        badge,
        badgeType,
        badgeVariants,
        hideChildrenInMenu = false,
        icon,
        link,
        order,
        title = '',
      } = meta;

      const name = title || (routeName === undefined ? '' : String(routeName));
      const resultChildren = hideChildrenInMenu
        ? []
        : visit(route.children ?? [], [...parents, path]);

      // 确定最终路径
      // 静态重定向可解析为菜单地址；函数重定向必须由实际导航上下文执行。
      let redirectPath = path;
      if (typeof redirect === 'string') redirectPath = redirect;
      else if (redirect && typeof redirect === 'object') {
        redirectPath = router.resolve(redirect).fullPath;
      }
      const resultPath = hideChildrenInMenu ? redirectPath : link || path;

      menus.push({
        activeIcon,
        badge,
        badgeType,
        badgeVariants,
        icon,
        name,
        order,
        parent: parents.at(-1),
        parents: parents.length > 0 ? parents : undefined,
        path: resultPath,
        show: true,
        children: resultChildren,
      });
    }
    return menus.toSorted(
      /** 零是有效优先级，无排序值时置于末尾。 */ (a, b) =>
        (a.order ?? 999) - (b.order ?? 999),
    );
  }
  return visit(routes, []);
}

/**
 * 转换后端菜单数据为路由数据
 * @param menuList 后端菜单数据
 * @param parent 父级菜单
 * @param nameSet 用于跟踪已使用的 name，防止重复
 * @returns 路由数据
 */
function convertServerMenuToRouteRecordStringComponent(
  menuList: AppRouteRecordRaw[],
  parent = '',
  nameSet: Set<string> = new Set(),
): RouteRecordStringComponent[] {
  const menus: RouteRecordStringComponent[] = [];
  menuList.forEach(
    /** 按节点种类生成路由，并递归转换其子级。
     * @param menu 已经接口边界校验的服务端菜单。
     */ (menu) => {
      // 处理外链菜单（顶级或子级）
      if (isHttpUrl(menu.path)) {
        // 如果有 ?_iframe 参数，则作为内嵌页面处理
        // 如果有 _iframe 参数，则使用 iframeSrc；如果没有，则使用 link
        const url = new URL(menu.path);
        let link: string | undefined;
        let iframeSrc: string | undefined;
        if (url.searchParams.has('_iframe')) {
          url.searchParams.delete('_iframe');
          iframeSrc = url.toString();
        } else {
          link = menu.path;
        }

        const urlMenu: RouteRecordStringComponent = {
          component: 'IFrameView',
          meta: {
            hideInMenu: !menu.visible,
            icon: menu.icon,
            iframeSrc,
            link,
            order: menu.sort,
            title: menu.name,
          },
          name: menu.name,
          path: `${menu.id}`,
        };
        menus.push(urlMenu);
        return;
      } else if (menu.children && menu.parentId === 0) {
        menu.component = 'BasicLayout';
      }
      if (menu.component === 'Layout') {
        menu.component = 'BasicLayout';
      }

      if (menu.children && menu.parentId !== 0) {
        menu.component = '';
      }

      // path
      if (parent) {
        menu.path = `${parent}/${menu.path}`;
      }

      if (!menu.path.startsWith('/')) {
        menu.path = `/${menu.path}`;
      }

      // 防止 name 重复，只有在 name 重复时才自动添加 id
      let finalName = menu.componentName || menu.name;
      if (nameSet.has(finalName)) {
        finalName = menu.name + menu.id;
        console.error(
          `menu name duplicate: ${menu.name}, id: ${menu.id}`,
          menu,
        );
      }
      nameSet.add(finalName);

      // 处理 menu.component 中的 query 参数
      let query: Record<string, string> | undefined;
      // 防止 component 为 null 时调用 indexOf 报错；关联
      if (!menu.component) {
        menu.component = '';
      }
      const queryIndex = menu.component.indexOf('?');
      if (queryIndex !== -1) {
        // 提取 query 字符串并解析为对象
        const queryString = menu.component.slice(queryIndex + 1);
        query = Object.fromEntries(new URLSearchParams(queryString).entries());
        // 移除 component 中的 query 部分
        menu.component = menu.component.slice(0, queryIndex);
      }

      const buildMenu: RouteRecordStringComponent = {
        component: menu.component,
        meta: {
          hideInMenu: !menu.visible,
          icon: menu.icon,
          keepAlive: menu.keepAlive,
          order: menu.sort,
          title: menu.name,
          ...(query && { query }),
        },
        name: finalName,
        path: menu.path,
      };

      if (menu.children && menu.children.length > 0) {
        buildMenu.children = convertServerMenuToRouteRecordStringComponent(
          menu.children,
          menu.path,
          nameSet,
        );
      }

      menus.push(buildMenu);
    },
  );
  return menus;
}

export { convertServerMenuToRouteRecordStringComponent, generateMenus };

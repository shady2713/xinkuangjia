/** 按初始化声明重建静态路由，防止曾被动态修改的根节点遗留权限。 */
import type { Router, RouteRecordRaw } from 'vue-router';

import { cloneDeep } from '@vben-core/shared/utils';

/**
 * 从静态声明重建命名路由，清除根路由曾被动态逻辑修改的子记录。
 * @param router 应用 Router；未命名动态路由由其安装者的移除句柄负责清理。
 * @param routes 初始化时使用的静态声明，不应传入 Router 的归一化记录。
 */
export function resetStaticRoutes(router: Router, routes: RouteRecordRaw[]) {
  router.getRoutes().forEach(
    /** 删除命名记录及其子树，随后以静态声明恢复。 */ ({ name }) => {
      if (name && router.hasRoute(name)) router.removeRoute(name);
    },
  );
  for (const route of cloneDeep(routes)) router.addRoute(route);
}

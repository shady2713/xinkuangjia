/**
 * 路由实例入口：按环境变量选择 hash 或 history 模式创建 vue-router，
 * 装配静态路由与守卫，并导出 resetRoutes 供退出登录时清空动态路由。
 * 具体路由表由 ./routes 与权限模块提供。
 */
import {
  createRouter,
  createWebHashHistory,
  createWebHistory,
} from 'vue-router';

import { resetAccessibleRoutes } from '@vben/access';
import { resetStaticRoutes } from '@vben/utils';

import { createRouterGuard } from './guard';
import { routes } from './routes';

/**
 *  @zh_CN 创建vue-router实例
 */
const router = createRouter({
  history:
    import.meta.env.VITE_ROUTER_HISTORY === 'hash'
      ? createWebHashHistory(import.meta.env.VITE_BASE)
      : createWebHistory(import.meta.env.VITE_BASE),
  // 应该添加到路由的初始路由列表。
  routes,
  scrollBehavior: (to, _from, savedPosition) => {
    if (savedPosition) {
      return savedPosition;
    }
    return to.hash ? { behavior: 'smooth', el: to.hash } : { left: 0, top: 0 };
  },
  // 是否应该禁止尾部斜杠。
  // strict: true,
});

/** 结束动态路由所有权并按静态声明恢复 Router，避免旧身份路由残留。 */
const resetRoutes = () => {
  resetAccessibleRoutes(router);
  resetStaticRoutes(router, routes);
};

// 创建路由守卫
createRouterGuard(router);

export { resetRoutes, router };

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
  /**
   * 路由切换后的滚动恢复策略：浏览器记录了历史位置就直接回到该位置，
   * 否则 URL 带 hash 时平滑滚动到对应元素，没有 hash 时回到页面顶部。
   *
   * @param to 目标路由，用它的 hash 判断是否需要滚动到锚点
   * @param _from 出发路由；本策略与来源页面无关，因此不使用
   * @param savedPosition 浏览器为前进或后退保存的历史滚动位置，存在时优先复用
   * @returns vue-router 的滚动目标：历史位置、锚点或页面顶部三者之一
   */
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

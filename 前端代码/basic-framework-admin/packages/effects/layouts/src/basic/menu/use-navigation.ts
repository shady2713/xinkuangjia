/**
 * 布局菜单的统一跳转入口：按路由 meta 判定外链、新窗口或站内跳转并执行。
 * 维护路由表快照供判定复用，菜单、标签栏等布局组件共用此入口；
 * 不含权限校验与菜单数据装配，取数仍由各调用方自行完成。
 */
import type { RouteRecordNormalized } from 'vue-router';

import { useRouter } from 'vue-router';

import { isHttpUrl, openRouteInNewWindow, openWindow } from '@vben/utils';

/** 提供菜单跳转与「是否新窗口打开」判定；跳转按外链、新窗口、站内跳转三种方式分流。 */
function useNavigation() {
  const router = useRouter();
  const routeMetaMap = new Map<string, RouteRecordNormalized>();

  // 初始化路由映射
  const initRouteMetaMap = () => {
    const routes = router.getRoutes();
    routes.forEach((route) => {
      routeMetaMap.set(route.path, route);
    });
  };

  initRouteMetaMap();

  // 监听路由变化
  router.afterEach(() => {
    initRouteMetaMap();
  });

  // 检查是否应该在新窗口打开
  const shouldOpenInNewWindow = (path: string): boolean => {
    if (isHttpUrl(path)) {
      return true;
    }
    const route = routeMetaMap.get(path);
    // 如果有外链或者设置了在新窗口打开，返回 true
    return !!(route?.meta?.link || route?.meta?.openInNewWindow);
  };

  /** 把站内路径解析为完整可访问的 href，供浏览器新窗口打开时使用。 */
  const resolveHref = (path: string): string => {
    return router.resolve(path).href;
  };

  /**
   * 执行一次菜单跳转：外链直接新窗口打开，站内路径按是否新窗口打开分流，否则走路由跳转。
   * @param path 目标路径或外链地址；站内路径会先查路由表以读取 meta 中的跳转配置。
   * @throws {unknown} 路由跳转失败时先记录日志再原样抛出，交由调用方处理。
   */
  const navigation = async (path: string) => {
    try {
      const route = routeMetaMap.get(path);
      const { openInNewWindow = false, query = {}, link } = route?.meta ?? {};

      // 检查是否有外链
      if (link && typeof link === 'string') {
        openWindow(link, { target: '_blank' });
        return;
      }

      if (isHttpUrl(path)) {
        openWindow(path, { target: '_blank' });
      } else if (openInNewWindow) {
        openRouteInNewWindow(resolveHref(path));
      } else {
        await router.push({
          path,
          query,
        });
      }
    } catch (error) {
      console.error('Navigation failed:', error);
      throw error;
    }
  };

  /** 判断该路径是否会以新窗口方式打开，供菜单渲染时决定是否显示外链标识。 */
  const willOpenedByWindow = (path: string) => {
    return shouldOpenInNewWindow(path);
  };

  return { navigation, willOpenedByWindow };
}

export { useNavigation };

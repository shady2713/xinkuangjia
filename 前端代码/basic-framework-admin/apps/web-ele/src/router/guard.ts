/**
 * 路由守卫，负责页面加载进度、登录态、权限路由和首次改密拦截。
 *
 * @author shady2713
 */
import type { RouteLocationNormalized, Router } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { $t } from '@vben/locales';
import { preferences } from '@vben/preferences';
import { useAccessStore, useDictStore, useUserStore } from '@vben/stores';
import { startProgress, stopProgress } from '@vben/utils';

import { getSimpleDictDataList } from '#/api/core/dict';
import { accessRoutes, coreRouteNames } from '#/router/routes';
import { useAuthStore } from '#/store';
import { showLoadingMessage } from '#/utils/feedback';

import { generateAccess } from './access';

/** 首次登录或管理员重置密码后的强制修改密码页。 */
const PASSWORD_CHANGE_PATH = '/change-password';

/**
 * 通用守卫配置
 * @param router
 */
function setupCommonGuard(router: Router) {
  // 记录已经加载的页面
  const loadedPaths = new Set<string>();

  router.beforeEach((to) => {
    to.meta.loaded = loadedPaths.has(to.path);

    // 页面加载进度条
    if (!to.meta.loaded && preferences.transition.progress) {
      startProgress();
    }
    return true;
  });

  router.afterEach((to) => {
    // 记录页面是否加载,如果已经加载，后续的页面切换动画等效果不在重复执行

    loadedPaths.add(to.path);

    // 关闭页面加载进度条
    if (preferences.transition.progress) {
      stopProgress();
    }
  });
}

/**
 * 权限访问守卫配置
 * @param router
 */
function setupAccessGuard(router: Router) {
  /**
   * 处理权限访问和首次改密拦截。
   *
   * @param to 目标路由
   * @param from 来源路由
   * @returns 放行、重定向目标或继续生成动态路由
   */
  const accessGuard = async (
    to: RouteLocationNormalized,
    from: RouteLocationNormalized,
  ) => {
    const accessStore = useAccessStore();
    const userStore = useUserStore();
    const authStore = useAuthStore();
    const dictStore = useDictStore();

    // 基本路由，这些路由不需要进入权限拦截
    if (coreRouteNames.includes(to.name as string)) {
      if (to.path === LOGIN_PATH && accessStore.accessToken) {
        return decodeURIComponent(
          (to.query?.redirect as string) || preferences.app.defaultHomePath,
        );
      }
      return true;
    }

    // accessToken 检查
    if (!accessStore.accessToken) {
      // 明确声明忽略权限访问权限，则可以访问
      if (to.meta.ignoreAccess) {
        return true;
      }

      // 没有访问权限，跳转登录页面
      if (to.fullPath !== LOGIN_PATH) {
        return {
          path: LOGIN_PATH,
          // 如不需要，直接删除 query
          query:
            to.fullPath === preferences.app.defaultHomePath
              ? {}
              : { redirect: encodeURIComponent(to.fullPath) },
          // 携带当前跳转的页面，登录后重新跳转该页面
          replace: true,
        };
      }
      return to;
    }

    // 是否已经生成过动态路由
    if (accessStore.isAccessChecked) {
      // 后端已返回强制改密标志时，除修改密码页外一律拦截。
      if (
        authStore.passwordChangeRequired &&
        to.path !== PASSWORD_CHANGE_PATH
      ) {
        return { path: PASSWORD_CHANGE_PATH, replace: true };
      }
      return true;
    }

    // 加载字典数据（不阻塞加载）
    dictStore.setDictCacheByApi(getSimpleDictDataList);

    // 生成路由表
    // 当前登录用户拥有的角色标识列表
    let userInfo = userStore.userInfo;
    if (!userInfo) {
      // 由于当前系统通过 fetchUserInfo 统一加载用户和权限信息，因此不再单独触发 fetchMenuListAsync
      const message = showLoadingMessage(`${$t('common.loadingMenu')}...`);
      try {
        const authPermissionInfo = await authStore.fetchUserInfo();
        if (authPermissionInfo) {
          userInfo = authPermissionInfo.user;
        }
      } finally {
        message.close();
      }
    }
    const userRoles = userStore.userRoles ?? [];

    // 生成菜单和路由
    const { accessibleMenus, accessibleRoutes } = await generateAccess({
      roles: userRoles,
      router,
      // 则会在菜单中显示，但是访问会被重定向到403
      routes: accessRoutes,
    });

    // 保存菜单信息和路由信息
    accessStore.setAccessMenus(accessibleMenus);
    accessStore.setAccessRoutes(accessibleRoutes);
    accessStore.setIsAccessChecked(true);
    userStore.setUserRoles(userRoles);
    // 动态路由已生成后再拦截，避免跳转到尚未注册的修改密码页。
    if (authStore.passwordChangeRequired && to.path !== PASSWORD_CHANGE_PATH) {
      return { path: PASSWORD_CHANGE_PATH, replace: true };
    }

    const redirectPath = (from.query.redirect ??
      (to.path === preferences.app.defaultHomePath
        ? preferences.app.defaultHomePath
        : to.fullPath)) as string;

    return {
      ...router.resolve(decodeURIComponent(redirectPath)),
      replace: true,
    };
  };
  router.beforeEach(accessGuard);
}

/**
 * 项目守卫配置
 * @param router
 */
function createRouterGuard(router: Router) {
  /** 通用 */
  setupCommonGuard(router);
  /** 权限访问 */
  setupAccessGuard(router);
}

export { createRouterGuard };

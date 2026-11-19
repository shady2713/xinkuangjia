/**
 * 路由守卫，负责页面加载进度、登录态、权限路由、安全重定向校验和首次改密拦截。
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

import { generateAccess, hasRoutePermission } from './access';

/** 首次登录或管理员重置密码后的强制修改密码页。 */
const PASSWORD_CHANGE_PATH = '/change-password';

/**
 * 安全解码并校验重定向路径，拒绝非法百分号编码及非站内单斜杠路径（阻断开放重定向）。
 *
 * @param raw 原始 query.redirect 参数值
 * @param fallback 校验不通过时的安全默认路径
 * @returns 安全的站内路由路径
 */
export function resolveSafeInternalRedirect(
  raw: unknown,
  fallback: string,
): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    return fallback;
  }
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded).trim();
  } catch {
    return fallback;
  }
  if (!/^\/(?!\/)/u.test(decoded) || /[\r\n\\]/u.test(decoded)) {
    return fallback;
  }
  return decoded;
}

/**
 * 通用进度条守卫配置。
 *
 * @param router Vue Router 实例
 */
function setupCommonGuard(router: Router) {
  const loadedPaths = new Set<string>();

  router.beforeEach((to) => {
    to.meta.loaded = loadedPaths.has(to.path);

    if (!to.meta.loaded && preferences.transition.progress) {
      startProgress();
    }
    return true;
  });

  router.afterEach((to) => {
    loadedPaths.add(to.path);

    if (preferences.transition.progress) {
      stopProgress();
    }
  });
}

/**
 * 权限访问与强制改密守卫配置。
 *
 * @param router Vue Router 实例
 */
function setupAccessGuard(router: Router) {
  /**
   * 处理权限访问、站内重定向归一化与首次改密拦截。
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

    if (coreRouteNames.includes(to.name as string)) {
      if (to.path === LOGIN_PATH && accessStore.accessToken) {
        return resolveSafeInternalRedirect(
          to.query?.redirect,
          preferences.app.defaultHomePath,
        );
      }
      return true;
    }

    if (!accessStore.accessToken) {
      if (to.meta.ignoreAccess) {
        return true;
      }

      if (to.fullPath !== LOGIN_PATH) {
        return {
          path: LOGIN_PATH,
          query:
            to.fullPath === preferences.app.defaultHomePath
              ? {}
              : { redirect: encodeURIComponent(to.fullPath) },
          replace: true,
        };
      }
      return to;
    }

    if (accessStore.isAccessChecked) {
      if (
        authStore.passwordChangeRequired &&
        to.path !== PASSWORD_CHANGE_PATH
      ) {
        return { path: PASSWORD_CHANGE_PATH, replace: true };
      }
      if (
        !hasRoutePermission(
          to.meta?.requiredPermissions,
          accessStore.accessCodes,
        )
      ) {
        return {
          name: 'FallbackNotFound',
          params: {
            path: to.path.replace(/^\/+/u, '').split('/').filter(Boolean),
          },
          replace: true,
        };
      }
      return true;
    }

    // 字典加载异常由 store 内部捕获记录，避免阻断后续菜单与路由初始化
    void dictStore.setDictCacheByApi(getSimpleDictDataList);

    let userInfo = userStore.userInfo;
    if (!userInfo) {
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

    const { accessibleMenus, accessibleRoutes } = await generateAccess({
      roles: userRoles,
      router,
      routes: accessRoutes,
    });

    accessStore.setAccessMenus(accessibleMenus);
    accessStore.setAccessRoutes(accessibleRoutes);
    accessStore.setIsAccessChecked(true);
    userStore.setUserRoles(userRoles);

    if (authStore.passwordChangeRequired && to.path !== PASSWORD_CHANGE_PATH) {
      return { path: PASSWORD_CHANGE_PATH, replace: true };
    }

    const fallbackTarget =
      to.path === preferences.app.defaultHomePath
        ? preferences.app.defaultHomePath
        : to.fullPath;
    const redirectPath = resolveSafeInternalRedirect(
      from.query.redirect,
      fallbackTarget,
    );

    return {
      ...router.resolve(redirectPath),
      replace: true,
    };
  };
  router.beforeEach(accessGuard);
}

/**
 * 注册项目路由守卫。
 *
 * @param router Vue Router 实例
 */
function createRouterGuard(router: Router) {
  setupCommonGuard(router);
  setupAccessGuard(router);
}

export { createRouterGuard };

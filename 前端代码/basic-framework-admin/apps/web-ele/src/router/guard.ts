import type { Router } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { $t } from '@vben/locales';
import { preferences } from '@vben/preferences';
import { useAccessStore, useDictStore, useUserStore } from '@vben/stores';
import { logWarn, startProgress, stopProgress } from '@vben/utils';

import { getSimpleDictDataList } from '#/api/core/dict';
import { accessRoutes, coreRouteNames } from '#/router/routes';
import { useAuthStore } from '#/store';
import { getSessionEpoch, isCurrentSession } from '#/utils/auth-session';
import { showLoadingMessage } from '#/utils/feedback';

import { generateAccess } from './access';

/** 解析登录后回跳地址，只接受单个、可解码的站内目标。
 * @param value 来自 URL 查询参数的未知值，数组或空值不属于有效回跳。
 * @param fallback 缺失或非法回跳时使用的站内首页。
 * @returns 可交给 Router 的站内路径，禁止登录页自循环及外部地址。
 */
function loginRedirect(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const path = decodeURIComponent(value);
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      [...path].some(
        /** 回跳地址不能包含不可见控制字符。 */ (character) =>
          (character.codePointAt(0) ?? 0) < 32 ||
          character.codePointAt(0) === 127,
      ) ||
      path.split(/[?#]/u)[0] === LOGIN_PATH
    )
      return fallback;
    return path;
  } catch {
    return fallback;
  }
}

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
  router.beforeEach(
    /** 校验登录并只为仍有效的身份安装菜单及路由。
     * @param to 当前导航目标。
     * @param from 发起导航的位置及原登录重定向信息。
     * @returns 允许、取消或重定向结果；旧身份取消，不能继续导航。
     * @throws {Error} 当前身份的权限请求失败时保留原错误，不伪装为导航成功。
     */ async (to, from) => {
      const accessStore = useAccessStore();
      const userStore = useUserStore();
      const authStore = useAuthStore();
      const dictStore = useDictStore();

      // 基本路由，这些路由不需要进入权限拦截
      if (to.name !== undefined && coreRouteNames.includes(to.name)) {
        if (to.path === LOGIN_PATH && accessStore.accessToken) {
          return loginRedirect(
            to.query.redirect,
            preferences.app.defaultHomePath,
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
        return true;
      }

      const epoch = getSessionEpoch();
      /** 本次权限加载的身份不得被其他登录、退出或失效操作替换。 */
      const isCurrent = () => isCurrentSession(epoch);
      // 不阻塞导航，但必须处理失败并在 Store 写入前检查生命周期。
      void dictStore
        .setDictCacheByApi(
          getSimpleDictDataList,
          {},
          'label',
          'value',
          isCurrent,
        )
        .catch(
          /** 当前字典加载失败可诊断，旧身份失败不打扰新账号。 */ () => {
            if (isCurrent()) logWarn('字典加载失败');
          },
        );

      // 生成路由表
      // 当前登录用户拥有的角色标识列表
      let userInfo = userStore.userInfo;
      if (!userInfo) {
        // 由于当前系统通过 fetchUserInfo 统一加载用户和权限信息，因此不再单独触发 fetchMenuListAsync
        const message = showLoadingMessage(`${$t('common.loadingMenu')}...`);
        try {
          const authPermissionInfo = await authStore.fetchUserInfo(epoch);
          if (authPermissionInfo) {
            userInfo = authPermissionInfo.user;
          }
        } catch (error) {
          // 旧导航的权限请求被取消时静默终止；当前身份的真实错误仍向上报告。
          if (!isCurrent()) return false;
          throw error;
        } finally {
          message.close();
        }
      }
      if (!isCurrent()) return false;
      const userRoles = userStore.userRoles ?? [];

      // 生成菜单和路由
      const { accessibleMenus, accessibleRoutes } = await generateAccess({
        roles: userRoles,
        router,
        // 则会在菜单中显示，但是访问会被重定向到403
        routes: accessRoutes,
        isCurrent,
      });

      if (!isCurrent()) return false;
      // 保存菜单信息和路由信息
      accessStore.setAccessMenus(accessibleMenus);
      accessStore.setAccessRoutes(accessibleRoutes);
      accessStore.setIsAccessChecked(true);
      userStore.setUserRoles(userRoles);
      const redirectPath = loginRedirect(
        from.query.redirect,
        to.path === preferences.app.defaultHomePath
          ? preferences.app.defaultHomePath
          : to.fullPath,
      );

      return {
        ...router.resolve(redirectPath),
        replace: true,
      };
    },
  );
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

import type { AuthPermissionInfo, UserInfo } from '@vben/types';

import type { AuthApi } from '#/api';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { ElMessage, ElNotification } from 'element-plus';
import { defineStore } from 'pinia';

import { getAuthPermissionInfoApi, loginApi, logoutApi, smsLogin } from '#/api';
import { $t } from '#/locales';
import { encryptPassword } from '#/utils/sm2';

/** 认证状态，负责账号密码/短信登录、会话注销、权限同步与强制改密状态。 */
function useAuthState() {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);

  /** 首次登录或管理员重置密码后，是否必须先修改密码。 */
  const passwordChangeRequired = ref(false);

  /**
   * 异步处理登录操作并同步权限路由状态。
   *
   * @param type 登录类型（账号密码或短信验证码）
   * @param params 登录表单数据
   * @param onSuccess 登录成功后的自定义回调
   * @returns 登录后的用户信息
   */
  async function authLogin(
    type: 'mobile' | 'username',
    params: AuthApi.LoginParams | AuthApi.SmsLoginParams,
    onSuccess?: () => Promise<void> | void,
  ) {
    let userInfo: null | UserInfo = null;
    try {
      let loginResult: AuthApi.LoginResult;
      loginLoading.value = true;
      if (type === 'mobile') {
        loginResult = await smsLogin(params as AuthApi.SmsLoginParams);
      } else {
        const loginParams = params as AuthApi.LoginParams;
        loginResult = await loginApi({
          ...loginParams,
          password: loginParams.password
            ? await encryptPassword(loginParams.password)
            : loginParams.password,
        });
      }
      const { accessToken, refreshToken } = loginResult;

      if (accessToken) {
        accessStore.setAccessToken(accessToken);
        accessStore.setRefreshToken(refreshToken);
        passwordChangeRequired.value = Boolean(
          loginResult.passwordChangeRequired,
        );

        const fetchUserInfoResult = await fetchUserInfo();
        userInfo = fetchUserInfoResult.user;

        const wasModalExpired = accessStore.loginExpired;
        if (wasModalExpired) {
          accessStore.setLoginExpired(false);
        }

        if (passwordChangeRequired.value) {
          ElMessage.warning('首次登录或密码被重置，请先修改密码');
          await router.push('/change-password');
        } else if (!wasModalExpired) {
          await (onSuccess
            ? onSuccess()
            : router.push(preferences.app.defaultHomePath));
        }

        if (userInfo?.nickname) {
          ElNotification.success({
            message: `${$t('authentication.loginSuccessDesc')}:${userInfo?.nickname}`,
            duration: 3000,
            title: $t('authentication.loginSuccess'),
          });
        }
      }
    } finally {
      loginLoading.value = false;
    }

    return {
      userInfo,
    };
  }

  /**
   * 退出登录，通知后端吊销令牌、重置所有 store 状态并跳转到登录页。
   *
   * @param redirect 是否在跳转登录页时附带当前页面回跳地址
   */
  async function logout(redirect: boolean = true) {
    try {
      const accessToken = accessStore.accessToken as string;
      if (accessToken) {
        await logoutApi(accessToken);
      }
    } catch {
      // 后端注销失败不阻塞前端本地态清理
    }
    resetAllStores();
    accessStore.setLoginExpired(false);

    await router.replace({
      path: LOGIN_PATH,
      query: redirect
        ? {
            redirect: encodeURIComponent(router.currentRoute.value.fullPath),
          }
        : {},
    });
  }

  /** 获取当前用户权限信息并更新到各个 store 中。 */
  async function fetchUserInfo() {
    const authPermissionInfo: AuthPermissionInfo | null =
      await getAuthPermissionInfoApi();
    userStore.setUserInfo(authPermissionInfo.user);
    passwordChangeRequired.value =
      passwordChangeRequired.value ||
      Boolean(authPermissionInfo.user?.passwordChangeRequired);
    userStore.setUserRoles(authPermissionInfo.roles);
    accessStore.setAccessMenus(authPermissionInfo.menus);
    accessStore.setAccessCodes(authPermissionInfo.permissions);
    return authPermissionInfo;
  }

  /** 密码修改成功后解除强制改密状态。 */
  function clearPasswordChangeRequired() {
    passwordChangeRequired.value = false;
  }

  /** 重置认证状态。 */
  function $reset() {
    loginLoading.value = false;
    passwordChangeRequired.value = false;
  }

  return {
    $reset,
    authLogin,
    clearPasswordChangeRequired,
    fetchUserInfo,
    loginLoading,
    logout,
    passwordChangeRequired,
  };
}

/**
 * 认证 store。
 *
 * @returns 认证 store
 */
export const useAuthStore = defineStore('auth', useAuthState);

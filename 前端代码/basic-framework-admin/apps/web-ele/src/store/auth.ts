import type { AuthPermissionInfo, UserInfo } from '@vben/types';

import type { AuthApi } from '#/api';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { ElMessage, ElNotification } from 'element-plus';
import { defineStore } from 'pinia';

import {
  getAuthPermissionInfoApi,
  loginApi,
  logoutApi,
  register,
  smsLogin,
} from '#/api';
import { $t } from '#/locales';
import { encryptPassword } from '#/utils/sm2';

/** 认证状态，负责登录、注册、令牌刷新后的用户信息和首次改密标志。 */
function useAuthState() {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);

  /** 首次登录或管理员重置密码后，是否必须先修改密码。 */
  const passwordChangeRequired = ref(false);

  /**
   * 异步处理登录操作
   * Asynchronously handle the login process
   * @param type 登录类型
   * @param params 登录表单数据
   * @param onSuccess 登录成功后的回调函数
   * @returns 登录后的用户信息
   */
  async function authLogin(
    type: 'mobile' | 'register' | 'username',
    params:
      | AuthApi.LoginParams
      | AuthApi.RegisterParams
      | AuthApi.SmsLoginParams,
    onSuccess?: () => Promise<void> | void,
  ) {
    // 异步处理用户登录操作并获取 accessToken
    let userInfo: null | UserInfo = null;
    try {
      let loginResult: AuthApi.LoginResult;
      loginLoading.value = true;
      switch (type) {
        case 'mobile': {
          loginResult = await smsLogin(params as AuthApi.SmsLoginParams);
          break;
        }
        case 'register': {
          const registerParams = params as AuthApi.RegisterParams;
          loginResult = await register({
            ...registerParams,
            password: await encryptPassword(registerParams.password),
          });
          break;
        }
        default: {
          const loginParams = params as AuthApi.LoginParams;
          loginResult = await loginApi({
            ...loginParams,
            // 登录表单校验后才会进入提交，判空后再加密，避免把空值传给 SM2。
            password: loginParams.password
              ? await encryptPassword(loginParams.password)
              : loginParams.password,
          });
        }
      }
      const { accessToken, refreshToken } = loginResult;

      // 如果成功获取到 accessToken
      if (accessToken) {
        accessStore.setAccessToken(accessToken);
        accessStore.setRefreshToken(refreshToken);
        // 登录响应和权限信息都携带该标志；任一为 true 都先强制改密。
        passwordChangeRequired.value = Boolean(
          loginResult.passwordChangeRequired,
        );

        // 获取用户信息并存储到 userStore、accessStore 中
        const fetchUserInfoResult = await fetchUserInfo();

        userInfo = fetchUserInfoResult.user;

        if (accessStore.loginExpired) {
          accessStore.setLoginExpired(false);
        } else if (passwordChangeRequired.value) {
          ElMessage.warning('首次登录或密码被重置，请先修改密码');
          await router.push('/change-password');
        } else {
          onSuccess
            ? await onSuccess?.()
            : await router.push(preferences.app.defaultHomePath);
        }

        if (userInfo?.nickname) {
          ElNotification.success({
            message: `${$t('authentication.loginSuccessDesc')}:${userInfo?.nickname}`,
            duration: 3,
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

  /** 退出登录，重置所有 store 状态并跳转到登录页 */
  async function logout(redirect: boolean = true) {
    try {
      const accessToken = accessStore.accessToken as string;
      if (accessToken) {
        await logoutApi(accessToken);
      }
    } catch {
      // 不做任何处理
    }
    resetAllStores();
    accessStore.setLoginExpired(false);

    // 回登录页带上当前路由地址
    await router.replace({
      path: LOGIN_PATH,
      query: redirect
        ? {
            redirect: encodeURIComponent(router.currentRoute.value.fullPath),
          }
        : {},
    });
  }

  /** 获取当前用户权限信息并更新到各个 store 中 */
  async function fetchUserInfo() {
    // 加载
    const authPermissionInfo: AuthPermissionInfo | null =
      await getAuthPermissionInfoApi();
    // userStore
    userStore.setUserInfo(authPermissionInfo.user);
    passwordChangeRequired.value =
      passwordChangeRequired.value ||
      Boolean(authPermissionInfo.user?.passwordChangeRequired);
    userStore.setUserRoles(authPermissionInfo.roles);
    // accessStore
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

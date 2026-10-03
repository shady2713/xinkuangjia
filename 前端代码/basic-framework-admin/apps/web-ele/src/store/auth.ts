/** 管理登录身份、权限初始化与退出；异步结果只允许写入所属会话。 */
import type { UserInfo } from '@vben/types';

import type { AuthApi } from '#/api';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';
import { logWarn, md5 } from '@vben/utils';

import { ElNotification } from 'element-plus';
import { defineStore } from 'pinia';

import {
  getAuthPermissionInfoApi,
  loginApi,
  logoutApi,
  register,
  smsLogin,
} from '#/api';
import { updateUserPassword } from '#/api/system/user/profile';
import { $t } from '#/locales';
import { resetRoutes } from '#/router';
import {
  advanceSession,
  assertCurrentSession,
  getSessionEpoch,
  isCurrentSession,
} from '#/utils/auth-session';

/** 当前身份初始化后执行的成功回调。 */
type LoginSuccess = () => Promise<void> | void;

/** 登录方式与参数保持关联，避免通过断言将短信参数当作密码登录参数。 */
type LoginArguments =
  | [type: 'mobile', params: AuthApi.SmsLoginParams, onSuccess?: LoginSuccess]
  | [type: 'register', params: AuthApi.RegisterParams, onSuccess?: LoginSuccess]
  | [type: 'username', params: AuthApi.LoginParams, onSuccess?: LoginSuccess];

/** 创建认证动作及展示状态，身份代次由独立模块管理。 */
export const useAuthStore = defineStore(
  'auth',
  /** 将认证异步结果约束在其发起身份内。 */ () => {
    const accessStore = useAccessStore();
    const userStore = useUserStore();
    const router = useRouter();

    const loginLoading = ref(false);

    /**
     * 异步处理登录操作
     * Asynchronously handle the login process
     * @param args 相互关联的登录方式、对应表单数据及可选成功回调。
     * @returns 成功初始化的用户；登录失败或身份切换时拒绝，不写入其他身份。
     */
    async function authLogin(...args: LoginArguments) {
      const [type, params, onSuccess] = args;
      const epoch = advanceSession();
      resetRoutes();
      resetAllStores();
      let userInfo: null | UserInfo = null;
      try {
        let loginResult: AuthApi.LoginResult;
        loginLoading.value = true;
        switch (type) {
          case 'mobile': {
            loginResult = await smsLogin(params);
            break;
          }
          case 'register': {
            const registerParams = { ...params };
            registerParams.password = md5(registerParams.password);
            loginResult = await register(registerParams);
            break;
          }
          default: {
            const loginParams = { ...params };
            loginParams.password = md5(loginParams.password);
            loginResult = await loginApi(loginParams);
          }
        }
        assertCurrentSession(epoch);
        const { accessToken, refreshToken } = loginResult;

        // 如果成功获取到 accessToken
        if (accessToken) {
          accessStore.setAccessToken(accessToken);
          accessStore.setRefreshToken(refreshToken);

          // 获取用户信息并存储到 userStore、accessStore 中
          const fetchUserInfoResult = await fetchUserInfo(epoch);
          assertCurrentSession(epoch);

          userInfo = fetchUserInfoResult.user;

          onSuccess
            ? await onSuccess()
            : await router.push(preferences.app.defaultHomePath);

          assertCurrentSession(epoch);
          if (userInfo?.nickname) {
            ElNotification.success({
              message: `${$t('authentication.loginSuccessDesc')}:${userInfo?.nickname}`,
              duration: 3,
              title: $t('authentication.loginSuccess'),
            });
          }
        }
      } finally {
        if (isCurrentSession(epoch)) loginLoading.value = false;
      }

      return {
        userInfo,
      };
    }

    /**
     * 同步清除当前身份及动态路由，随后等待服务端撤销和登录页导航。
     * @param redirect 是否携带当前页面作为下次登录的跳转目标。
     * @returns 本地导航和远端撤销完成；远端失败会记录但不恢复已退出身份。
     */
    async function logout(redirect: boolean = true) {
      const accessToken = accessStore.accessToken;
      const fullPath = router.currentRoute.value.fullPath;
      advanceSession();
      resetRoutes();
      resetAllStores();
      accessStore.setLoginExpired(false);
      // 导航立即发起，远端退出迟到不得再次重置 Store 或重定向新账号。
      const navigation = router.replace({
        path: LOGIN_PATH,
        query: redirect ? { redirect: encodeURIComponent(fullPath) } : {},
      });
      const revocation = accessToken
        ? logoutApi(accessToken).catch(
            /** 远端失败不能恢复已经清空的本地会话。 */ () => {
              logWarn('服务端退出未确认，本地登录身份已清除');
            },
          )
        : Promise.resolve();
      await Promise.all([navigation, revocation]);
    }

    /**
     * 修改当前账号密码；服务端撤销全部旧会话后退出本地身份。
     * @param passwords 表单的原始密码；仅在请求边界按既有协议摘要。
     * @param passwords.newPassword 待设置的新密码。
     * @param passwords.oldPassword 用于验证改密资格的原密码。
     * @returns 修改及退出完成；原身份已经切换时取消且不影响新登录。
     * @throws {Error} 修改失败或响应属于已结束的身份。
     */
    async function changePassword(passwords: {
      newPassword: string;
      oldPassword: string;
    }) {
      const epoch = getSessionEpoch();
      await updateUserPassword({
        newPassword: md5(passwords.newPassword),
        oldPassword: md5(passwords.oldPassword),
      });
      assertCurrentSession(epoch);
      await logout(false);
    }

    /** 获取本身份权限并在写入前确认身份，防止旧请求覆盖新账号。
     * @param epoch 请求所属会话，默认捕获当前身份。
     * @returns 当前用户及其权限信息。
     * @throws {Error} 获取失败或请求返回时身份已变更。
     */
    async function fetchUserInfo(epoch = getSessionEpoch()) {
      // 加载
      const authPermissionInfo = await getAuthPermissionInfoApi();
      assertCurrentSession(epoch);
      // userStore
      userStore.setUserInfo(authPermissionInfo.user);
      userStore.setUserRoles(authPermissionInfo.roles);
      // accessStore
      accessStore.setServerMenus(authPermissionInfo.menus);
      accessStore.setAccessCodes(authPermissionInfo.permissions);
      return authPermissionInfo;
    }

    /** 仅重置展示状态；身份代次在 Store 外管理，不随 reset 回退。 */
    function $reset() {
      loginLoading.value = false;
    }

    return {
      $reset,
      authLogin,
      changePassword,
      fetchUserInfo,
      loginLoading,
      logout,
    };
  },
);

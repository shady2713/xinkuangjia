/**
 * 用户认证状态、角色权限码与后端菜单树存储。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

import {
  type CurrentUserInfo,
  getPermissionInfoApi,
  loginApi,
  type LoginReq,
  logoutApi,
  type MenuRouteItem,
  smsLoginApi,
  type SmsLoginReq,
} from '@/api/auth';
import {
  clearTokens,
  getAccessToken,
  passwordChangeRequiredFlag,
  setTokens,
} from '@/utils/token';

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<CurrentUserInfo | null>(null);
  const roles = ref<string[]>([]);
  const permissions = ref<string[]>([]);
  const menus = ref<MenuRouteItem[]>([]);
  const routesLoaded = ref(false);
  const passwordChangeRequired = passwordChangeRequiredFlag;

  async function loginByPassword(params: LoginReq) {
    const res = await loginApi(params);
    const mustChange = Boolean(res.passwordChangeRequired);
    setTokens(res.accessToken, res.refreshToken, mustChange);
    return res;
  }

  async function loginBySms(params: SmsLoginReq) {
    const res = await smsLoginApi(params);
    const mustChange = Boolean(res.passwordChangeRequired);
    setTokens(res.accessToken, res.refreshToken, mustChange);
    return res;
  }

  async function fetchPermissionInfo() {
    const info = await getPermissionInfoApi();
    userInfo.value = info.user ?? null;
    roles.value = info.roles ?? [];
    permissions.value = info.permissions ?? [];
    menus.value = info.menus ?? [];
    return info;
  }

  function markRoutesLoaded(loaded: boolean) {
    routesLoaded.value = loaded;
  }

  function resetState() {
    userInfo.value = null;
    roles.value = [];
    permissions.value = [];
    menus.value = [];
    routesLoaded.value = false;
    clearTokens();
  }

  async function logout() {
    const token = getAccessToken();
    try {
      if (token) {
        await logoutApi(token);
      }
    } catch {
      // 忽略登出接口异常，始终清理本地登录态
    } finally {
      resetState();
    }
  }

  return {
    userInfo,
    roles,
    permissions,
    menus,
    routesLoaded,
    passwordChangeRequired,
    loginByPassword,
    loginBySms,
    fetchPermissionInfo,
    markRoutesLoaded,
    resetState,
    logout,
  };
});

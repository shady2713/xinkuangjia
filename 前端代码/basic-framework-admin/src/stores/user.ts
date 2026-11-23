/**
 * 用户认证状态、角色权限码与后端菜单树存储。
 */
import { CanceledError } from 'axios';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

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
import { updateUserPasswordApi } from '@/api/system/profile';
import { encryptPassword } from '@/utils/sm2';
import {
  clearTokens,
  getAccessToken,
  getSessionId,
  type LoginPlatform,
  passwordChangeRequiredFlag,
  sessionId,
  setLoginTokens,
} from '@/utils/token';

export const useUserStore = defineStore('user', () => {
  const userInfo = ref<CurrentUserInfo | null>(null);
  const roles = ref<string[]>([]);
  const permissions = ref<string[]>([]);
  const menus = ref<MenuRouteItem[]>([]);
  const routesLoaded = ref(false);
  const passwordChangeRequired = passwordChangeRequiredFlag;

  function clearUserState() {
    userInfo.value = null;
    roles.value = [];
    permissions.value = [];
    menus.value = [];
    routesLoaded.value = false;
  }

  watch(sessionId, clearUserState, { flush: 'sync' });

  /** Rejects results that belong to a login replaced while the request was in flight. */
  function assertSession(startId: string | null) {
    if (getSessionId() !== startId) {
      throw new CanceledError('登录会话已切换');
    }
  }

  async function loginByPassword(params: LoginReq, platform: LoginPlatform = 'super') {
    const startId = getSessionId();
    const res = await loginApi(params, platform);
    if (!setLoginTokens(res.accessToken, res.refreshToken, res.passwordChangeRequired, startId, platform)) {
      throw new CanceledError('登录会话已切换');
    }
    return res;
  }

  async function loginBySms(params: SmsLoginReq) {
    const startId = getSessionId();
    const res = await smsLoginApi(params);
    if (!setLoginTokens(res.accessToken, res.refreshToken, res.passwordChangeRequired, startId, 'business')) {
      throw new CanceledError('登录会话已切换');
    }
    return res;
  }

  async function fetchPermissionInfo() {
    const startId = getSessionId();
    const info = await getPermissionInfoApi();
    assertSession(startId);
    userInfo.value = info.user ?? null;
    roles.value = info.roles ?? [];
    permissions.value = info.permissions ?? [];
    menus.value = info.menus ?? [];
    return info;
  }

  /** Refreshes only the displayed identity; roles, permissions and menus stay aligned with registered routes. */
  async function refreshUserInfo() {
    const startId = getSessionId();
    const info = await getPermissionInfoApi();
    assertSession(startId);
    if (info.user) userInfo.value = info.user;
  }

  /** Self-service password change bound to owner; signs that login out locally on success, false if no longer current. */
  async function changeOwnPassword(
    owner: string | null,
    oldPlain: string,
    newPlain: string,
  ): Promise<boolean> {
    if (!owner || getSessionId() !== owner) return false;
    const oldPassword = await encryptPassword(oldPlain);
    if (getSessionId() !== owner) return false;
    const newPassword = await encryptPassword(newPlain);
    if (getSessionId() !== owner) return false;
    await updateUserPasswordApi({ oldPassword, newPassword });
    // The committed change invalidates this login's server sessions; clear only the same login locally.
    return resetState(owner);
  }

  function markRoutesLoaded(loaded: boolean) {
    routesLoaded.value = loaded;
  }

  /** Clears only the login identified by expectedId; returns false if another login is current. */
  function resetState(expectedId: string | null = getSessionId()): boolean {
    if (!clearTokens(expectedId)) return false;
    clearUserState();
    return true;
  }

  async function logout(): Promise<boolean> {
    const startId = getSessionId();
    const token = getAccessToken();
    try {
      if (token) {
        await logoutApi(token);
      }
    } catch {
      // 忽略登出接口异常，仍清理发起登出的本地登录态
    }
    return resetState(startId);
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
    refreshUserInfo,
    changeOwnPassword,
    markRoutesLoaded,
    resetState,
    logout,
  };
});

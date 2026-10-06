/** 管理凭据、服务端权限模型及路由转换后的独立展示状态。 */
import type { RouteRecordRaw } from 'vue-router';

import type { AppRouteRecordRaw, MenuRecordRaw } from '@vben-core/typings';

import { acceptHMRUpdate, defineStore } from 'pinia';

/** 访问凭据的取值：未登录时为 null，已登录时是非空字符串。 */
type AccessToken = null | string;

/** 访问权限 store 的状态：凭据、权限码、展示菜单与路由，以及锁屏和登录过期标记。 */
interface AccessState {
  /**
   * 权限码
   */
  accessCodes: string[];
  /**
   * 可访问的菜单列表
   */
  accessMenus: MenuRecordRaw[];
  /**
   * 可访问的路由列表
   */
  accessRoutes: RouteRecordRaw[];
  /**
   * 登录 accessToken
   */
  accessToken: AccessToken;
  /**
   * 是否已经检查过权限
   */
  isAccessChecked: boolean;
  /**
   * 是否锁屏状态
   */
  isLockScreen: boolean;
  /**
   * 锁屏密码
   */
  lockScreenPassword?: string;
  /**
   * 登录是否过期
   */
  loginExpired: boolean;
  /**
   * 登录 accessToken
   */
  refreshToken: AccessToken;
  /** 服务端原始权限菜单，独立于展示菜单，禁止通过同一字段反复变换类型。 */
  serverMenus: AppRouteRecordRaw[];
}

/**
 * 定义可按身份重置的访问权限状态，服务端菜单不进入持久化缓存。
 */
export const useAccessStore = defineStore('core-access', {
  actions: {
    /** 保存已经校验的服务端权限菜单，供路由生成器使用。
     * @param menus 只含服务端 DTO 字段的独立菜单集合。
     */
    setServerMenus(menus: AppRouteRecordRaw[]) {
      this.serverMenus = menus;
    },
    /**
     * 在已生成的展示菜单树里按路径查找菜单项。
     * @param path - 菜单路径，需要与菜单自身的 path 完全相等。
     * @returns 第一个命中的菜单；整棵树都没有该路径时返回 undefined。
     */
    getMenuByPath(path: string) {
      /**
       * 深度优先递归查找：先比对当前层，再按顺序下探子菜单。
       * @param menus - 当前层的菜单数组。
       * @param path - 目标菜单路径。
       * @returns 命中的菜单；本层及其后代都没有时返回 undefined。
       */
      function findMenu(
        menus: MenuRecordRaw[],
        path: string,
      ): MenuRecordRaw | undefined {
        for (const menu of menus) {
          if (menu.path === path) {
            return menu;
          }
          if (menu.children) {
            const matched = findMenu(menu.children, path);
            if (matched) {
              return matched;
            }
          }
        }
      }
      return findMenu(this.accessMenus, path);
    },
    /**
     * 进入锁屏状态并记下解锁口令。
     * @param password - 锁屏口令；该字段在 persist 的 pick 列表内，会被写入本地存储。
     */
    lockScreen(password: string) {
      this.isLockScreen = true;
      this.lockScreenPassword = password;
    },
    /**
     * 覆盖当前身份拥有的权限码集合。
     * @param codes - 权限码数组，直接替换而不与旧值合并。
     */
    setAccessCodes(codes: string[]) {
      this.accessCodes = codes;
    },
    /**
     * 覆盖供界面展示的菜单树。
     * @param menus - 已由服务端菜单转换好的展示菜单，直接替换而不合并。
     */
    setAccessMenus(menus: MenuRecordRaw[]) {
      this.accessMenus = menus;
    },
    /**
     * 覆盖当前身份可访问的动态路由表。
     * @param routes - 经过权限过滤的 vue-router 路由数组。
     */
    setAccessRoutes(routes: RouteRecordRaw[]) {
      this.accessRoutes = routes;
    },
    /**
     * 写入登录访问令牌。
     * @param token - 新的 accessToken；传 null 表示清除登录态。
     */
    setAccessToken(token: AccessToken) {
      this.accessToken = token;
    },
    /**
     * 标记权限校验流程是否已经跑完，用于避免重复生成动态路由。
     * @param isAccessChecked - 校验完成传 true；退出登录或需要重新校验时传 false。
     */
    setIsAccessChecked(isAccessChecked: boolean) {
      this.isAccessChecked = isAccessChecked;
    },
    /**
     * 标记登录态是否已过期，供界面提示重新登录。
     * @param loginExpired - 已过期传 true。
     */
    setLoginExpired(loginExpired: boolean) {
      this.loginExpired = loginExpired;
    },
    /**
     * 写入刷新令牌。
     * @param token - 新的 refreshToken；传 null 表示清除。
     */
    setRefreshToken(token: AccessToken) {
      this.refreshToken = token;
    },
    /** 退出锁屏状态并清空锁屏口令，使后续访问不再需要解锁。 */
    unlockScreen() {
      this.isLockScreen = false;
      this.lockScreenPassword = undefined;
    },
  },
  persist: {
    // 持久化
    pick: [
      'accessToken',
      'refreshToken',
      'accessCodes',
      'isLockScreen',
      'lockScreenPassword',
    ],
  },
  /** 每次重置恢复空权限与空菜单，不复用前一身份对象。 */
  state: (): AccessState => ({
    serverMenus: [],
    accessCodes: [],
    accessMenus: [],
    accessRoutes: [],
    accessToken: null,
    isAccessChecked: false,
    isLockScreen: false,
    lockScreenPassword: undefined,
    loginExpired: false,
    refreshToken: null,
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useAccessStore, hot));
}

/** 用户展示状态仅接收已经过接口边界校验的明确字段。 */
import type { BasicUserInfo } from '@vben-core/typings';

import { acceptHMRUpdate, defineStore } from 'pinia';

/** 当前用户及角色的可重置展示状态。 */
interface AccessState {
  /**
   * 用户信息
   */
  userInfo: BasicUserInfo | null;
  /**
   * 用户角色
   */
  userRoles: string[];
}

/**
 * 定义可重置的用户展示身份及独立角色列表。
 */
export const useUserStore = defineStore('core-user', {
  actions: {
    /** 写入已验证身份；清空身份时一并撤销角色，防止残留授权展示。
     * @param userInfo 已经接口边界规范化的用户，null 表示退出。
     */
    setUserInfo(userInfo: BasicUserInfo | null) {
      this.userInfo = userInfo;
      if (!userInfo) {
        this.userRoles = [];
      }
    },
    /** 替换当前身份对应的角色列表。
     * @param roles 本次身份已验证的角色标识。
     */
    setUserRoles(roles: string[]) {
      this.userRoles = roles;
    },
  },
  /** 为每个 Pinia 实例创建独立的空用户状态。 */
  state: (): AccessState => ({
    userInfo: null,
    userRoles: [],
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useUserStore, hot));
}

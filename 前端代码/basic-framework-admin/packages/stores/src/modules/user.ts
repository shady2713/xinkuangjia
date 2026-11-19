/** 用户基础信息状态 store，保存当前登录用户资料与角色编码。 */
import { acceptHMRUpdate, defineStore } from 'pinia';

interface BasicUserInfo {
  [key: string]: any;
  /**
   * 头像
   */
  avatar: string;
  /**
   * 部门编号
   */
  deptId?: number | string;
  /**
   * 用户邮箱
   */
  email?: string;
  /**
   * 用户编号（后端认证信息主键）
   */
  id?: number | string;
  /**
   * 用户昵称
   */
  nickname: string;
  /**
   * 是否要求先修改密码
   */
  passwordChangeRequired?: boolean;
  /**
   * 兼容字段：部分模板中使用的用户 id
   */
  userId?: string;
  /**
   * 用户名
   */
  username: string;
  /**
   * 所属后台类型
   */
  userType?: string;
}

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
 * @zh_CN 用户信息相关
 */
export const useUserStore = defineStore('core-user', {
  actions: {
    setUserInfo(userInfo: BasicUserInfo | null) {
      this.userInfo = userInfo;
      if (!userInfo) {
        this.userRoles = [];
      }
    },
    setUserRoles(roles: string[]) {
      this.userRoles = roles;
    },
  },
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

import type { AppRouteRecordRaw, BasicUserInfo } from '@vben-core/typings';

/** 用户信息（扩展基础用户信息） */
interface UserInfo extends BasicUserInfo {
  /**
   * 首页地址
   */
  homePath: string;
}

/** 认证权限信息，包含用户、角色、权限码和菜单 */
interface AuthPermissionInfo {
  user: UserInfo;
  roles: string[];
  permissions: string[];
  menus: AppRouteRecordRaw[];
}

export type { AuthPermissionInfo, UserInfo };

/**
 * 用户与认证领域类型：UserInfo 在基础用户信息上补充首页地址，
 * AuthPermissionInfo 描述一次认证返回的用户、角色、权限码与菜单树。
 * 只声明后端响应的结构，取值与转换由 api、store 层负责。
 */
import type { AppRouteRecordRaw, BasicUserInfo } from '@vben-core/typings';

/** 用户信息（扩展基础用户信息） */
interface UserInfo extends BasicUserInfo {
  /**
   * 首页地址
   */
  homePath?: string;
}

/** 认证权限信息，包含用户、角色、权限码和菜单 */
interface AuthPermissionInfo {
  user: UserInfo;
  roles: string[];
  permissions: string[];
  menus: AppRouteRecordRaw[];
}

export type { AuthPermissionInfo, UserInfo };

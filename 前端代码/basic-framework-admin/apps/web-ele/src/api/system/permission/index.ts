/**
 * RBAC 权限分配接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemPermissionApi {
  /** 分配用户角色请求（源自后端 PermissionAssignUserRoleReqVO 契约） */
  export type AssignUserRoleReqVO =
    OpenApiSchemas.PermissionAssignUserRoleReqVO;

  /** 分配角色菜单请求（源自后端 PermissionAssignRoleMenuReqVO 契约） */
  export type AssignRoleMenuReqVO =
    OpenApiSchemas.PermissionAssignRoleMenuReqVO;

  /** 分配角色数据权限请求（源自后端 PermissionAssignRoleDataScopeReqVO 契约） */
  export type AssignRoleDataScopeReqVO =
    OpenApiSchemas.PermissionAssignRoleDataScopeReqVO;
}

/**
 * 查询角色拥有的菜单权限编号列表。
 *
 * @param roleId 角色编号
 * @returns 菜单编号集合
 */
export async function getRoleMenuList(roleId: number | string) {
  return requestClient.get<(number | string)[]>(
    `/system/permission/list-role-menus?roleId=${roleId}`,
  );
}

/**
 * 赋予角色菜单权限。
 *
 * @param data 角色与菜单编号集合
 * @returns 授权结果
 */
export async function assignRoleMenu(
  data: SystemPermissionApi.AssignRoleMenuReqVO,
) {
  return requestClient.post('/system/permission/assign-role-menu', data);
}

/**
 * 赋予角色数据权限。
 *
 * @param data 角色与数据范围参数
 * @returns 授权结果
 */
export async function assignRoleDataScope(
  data: SystemPermissionApi.AssignRoleDataScopeReqVO,
) {
  return requestClient.post('/system/permission/assign-role-data-scope', data);
}

/**
 * 查询用户拥有的角色编号列表。
 *
 * @param userId 用户编号
 * @returns 角色编号集合
 */
export async function getUserRoleList(userId: number | string) {
  return requestClient.get<(number | string)[]>(
    `/system/permission/list-user-roles?userId=${userId}`,
  );
}

/**
 * 赋予用户角色。
 *
 * @param data 用户与角色编号集合
 * @returns 授权结果
 */
export async function assignUserRole(
  data: SystemPermissionApi.AssignUserRoleReqVO,
) {
  return requestClient.post('/system/permission/assign-user-role', data);
}

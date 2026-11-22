/**
 * 权限分配接口（角色菜单、角色数据权限、用户角色）。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';

import { request } from '@/api/request';

export function getRoleMenuListApi(roleId: number | string) {
  return request.get<(number | string)[]>('/system/permission/list-role-menus', {
    params: { roleId },
  });
}

export function assignRoleMenuApi(
  data: OpenApiSchemas.PermissionAssignRoleMenuReqVO,
) {
  return request.post<boolean>('/system/permission/assign-role-menu', data);
}

export function assignRoleDataScopeApi(
  data: OpenApiSchemas.PermissionAssignRoleDataScopeReqVO,
) {
  return request.post<boolean>(
    '/system/permission/assign-role-data-scope',
    data,
  );
}

export function getUserRoleListApi(userId: number | string) {
  return request.get<(number | string)[]>('/system/permission/list-user-roles', {
    params: { userId },
  });
}

export function assignUserRoleApi(
  data: OpenApiSchemas.PermissionAssignUserRoleReqVO,
) {
  return request.post<boolean>('/system/permission/assign-user-role', data);
}

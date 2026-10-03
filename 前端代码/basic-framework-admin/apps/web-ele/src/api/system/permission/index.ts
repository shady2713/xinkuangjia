/**
 * 角色与用户授权接口：查询与分配菜单权限、数据范围和角色。
 */
import { requestClient } from '#/api/request';

export namespace SystemPermissionApi {
  /** 分配用户角色请求 */
  export interface AssignUserRoleReqVO {
    userId: number;
    roleIds: number[];
  }

  /** 分配角色菜单请求 */
  export interface AssignRoleMenuReqVO {
    roleId: number;
    menuIds: number[];
  }

  /** 分配角色数据权限请求 */
  export interface AssignRoleDataScopeReqVO {
    roleId: number;
    dataScope: number;
    dataScopeDeptIds: number[];
  }
}

/**
 * 查询角色已分配的菜单权限。
 * @param roleId 目标角色的主键。
 * @returns 该角色勾选的菜单编号集合。
 */
export async function getRoleMenuList(roleId: number) {
  return requestClient.get(
    `/system/permission/list-role-menus?roleId=${roleId}`,
  );
}

/**
 * 覆盖式分配角色的菜单权限：未勾选的菜单会被取消。
 * @param data 角色主键与目标菜单编号集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export async function assignRoleMenu(
  data: SystemPermissionApi.AssignRoleMenuReqVO,
) {
  return requestClient.post('/system/permission/assign-role-menu', data);
}

/**
 * 覆盖式分配角色的数据范围：未勾选的部门会被移出可见范围。
 * @param data 角色主键、数据范围类型与目标部门编号集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export async function assignRoleDataScope(
  data: SystemPermissionApi.AssignRoleDataScopeReqVO,
) {
  return requestClient.post('/system/permission/assign-role-data-scope', data);
}

/**
 * 查询用户已分配的角色编号列表。
 * @param userId 目标用户的主键。
 * @returns 该用户已分配的角色编号集合；未分配时为空数组。
 */
export async function getUserRoleList(userId: number) {
  return requestClient.get<number[]>(
    `/system/permission/list-user-roles?userId=${userId}`,
  );
}

/**
 * 覆盖式分配用户的角色：未勾选的角色会被取消。
 * @param data 用户主键与目标角色编号集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export async function assignUserRole(
  data: SystemPermissionApi.AssignUserRoleReqVO,
) {
  return requestClient.post('/system/permission/assign-user-role', data);
}

/**
 * 角色管理接口：分页、增删改查与导出，参数直接透传给后端。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace SystemRoleApi {
  /** 角色信息 */
  export interface Role {
    id?: number;
    name: string;
    code: string;
    sort: number;
    status: number;
    type: number;
    dataScope: number;
    dataScopeDeptIds: number[];
    createTime?: Date;
  }
}

/**
 * 分页查询角色列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含角色记录列表与总条数。
 */
export function getRolePage(params: PageParam) {
  return requestClient.get<PageResult<SystemRoleApi.Role>>(
    '/system/role/page',
    { params },
  );
}

/**
 * 查询全部角色的精简列表，用于下拉选择。
 * @returns 角色的精简列表，不含详情字段。
 */
export function getSimpleRoleList() {
  return requestClient.get<SystemRoleApi.Role[]>('/system/role/simple-list');
}

/**
 * 按主键查询单个角色。
 * @param id 目标角色的主键。
 * @returns 角色详情。
 */
export function getRole(id: number) {
  return requestClient.get<SystemRoleApi.Role>(`/system/role/get?id=${id}`);
}

/**
 * 新增角色。
 * @param data 待保存的角色数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function createRole(data: SystemRoleApi.Role) {
  return requestClient.post('/system/role/create', data);
}

/**
 * 修改角色。
 * @param data 待保存的角色数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateRole(data: SystemRoleApi.Role) {
  return requestClient.put('/system/role/update', data);
}

/**
 * 删除指定角色。
 * @param id 目标角色的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteRole(id: number) {
  return requestClient.delete(`/system/role/delete?id=${id}`);
}

/**
 * 批量删除角色。
 * @param ids 待批量操作的角色主键集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteRoleList(ids: number[]) {
  return requestClient.delete(`/system/role/delete-list?ids=${ids.join(',')}`);
}

/**
 * 按当前筛选条件导出角色，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportRole(params: ExportQuery) {
  return requestClient.download('/system/role/export-excel', {
    params,
  });
}

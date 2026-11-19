/**
 * 角色管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemRoleApi {
  /** 角色信息（源自后端 RoleRespVO 契约） */
  export type Role = Omit<OpenApiSchemas.RoleRespVO, 'id'> & {
    id?: number | string;
  };
}

/** 角色下拉项，仅含编号、名称和状态（源自后端 RoleSimpleRespVO 契约）。 */
export type RoleSimple = OpenApiSchemas.RoleSimpleRespVO;

/**
 * 分页查询角色列表。
 *
 * @param params 分页与筛选参数
 * @returns 角色分页结果
 */
export function getRolePage(params: PageParam) {
  return requestClient.get<PageResult<SystemRoleApi.Role>>(
    '/system/role/page',
    { params },
  );
}

/**
 * 查询角色精简列表。
 *
 * @returns 角色精简列表
 */
export function getSimpleRoleList() {
  return requestClient.get<RoleSimple[]>('/system/role/simple-list');
}

/**
 * 查询角色详情。
 *
 * @param id 角色主键编号
 * @returns 角色详情
 */
export function getRole(id: number | string) {
  return requestClient.get<SystemRoleApi.Role>(`/system/role/get?id=${id}`);
}

/**
 * 新增角色。
 *
 * @param data 角色保存请求
 * @returns 新建角色编号
 */
export function createRole(data: OpenApiSchemas.RoleSaveReqVO) {
  return requestClient.post('/system/role/create', data);
}

/**
 * 修改角色。
 *
 * @param data 角色保存请求
 * @returns 修改结果
 */
export function updateRole(data: OpenApiSchemas.RoleSaveReqVO) {
  return requestClient.put('/system/role/update', data);
}

/**
 * 删除单个角色。
 *
 * @param id 角色主键编号
 * @returns 删除结果
 */
export function deleteRole(id: number | string) {
  return requestClient.delete(`/system/role/delete?id=${id}`);
}

/**
 * 批量删除角色。
 *
 * @param ids 角色编号集合
 * @returns 批量删除结果
 */
export function deleteRoleList(ids: (number | string)[]) {
  return requestClient.delete(`/system/role/delete-list?ids=${ids.join(',')}`);
}

/**
 * 导出角色 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportRole(params: PageParam) {
  return requestClient.download('/system/role/export-excel', {
    params,
  });
}

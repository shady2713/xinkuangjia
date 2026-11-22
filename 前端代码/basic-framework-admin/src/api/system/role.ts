/**
 * 角色管理接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';
import type { PageParam, PageResult } from '@/api/request';

import { request } from '@/api/request';

export type RoleItem = OpenApiSchemas.RoleRespVO;
export type RoleSaveReq = OpenApiSchemas.RoleSaveReqVO;

export function getRolePageApi(params: PageParam) {
  return request.get<PageResult<RoleItem>>('/system/role/page', { params });
}

export function getSimpleRoleListApi() {
  return request.get<RoleItem[]>('/system/role/simple-list');
}

export function getRoleApi(id: number | string) {
  return request.get<RoleItem>('/system/role/get', { params: { id } });
}

export function createRoleApi(data: RoleSaveReq) {
  return request.post<number | string>('/system/role/create', data);
}

export function updateRoleApi(data: RoleSaveReq) {
  return request.put<boolean>('/system/role/update', data);
}

export function deleteRoleApi(id: number | string) {
  return request.delete<boolean>('/system/role/delete', { params: { id } });
}

export function deleteRoleListApi(ids: (number | string)[]) {
  return request.delete<boolean>(`/system/role/delete-list?ids=${ids.join(',')}`);
}

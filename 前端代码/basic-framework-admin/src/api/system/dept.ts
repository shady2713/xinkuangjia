/**
 * 部门管理接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';

import { request } from '@/api/request';

export type DeptItem = OpenApiSchemas.DeptRespVO;
export type DeptSimple = OpenApiSchemas.DeptSimpleRespVO;
export type DeptSaveReq = OpenApiSchemas.DeptSaveReqVO;

export function getDeptListApi(params?: OpenApiSchemas.DeptListReqVO) {
  return request.get<DeptItem[]>('/system/dept/list', { params });
}

export function getSimpleDeptListApi() {
  return request.get<DeptSimple[]>('/system/dept/simple-list');
}

export function getDeptApi(id: number | string) {
  return request.get<DeptItem>('/system/dept/get', { params: { id } });
}

export function createDeptApi(data: DeptSaveReq) {
  return request.post<number | string>('/system/dept/create', data);
}

export function updateDeptApi(data: DeptSaveReq) {
  return request.put<boolean>('/system/dept/update', data);
}

export function deleteDeptApi(id: number | string) {
  return request.delete<boolean>('/system/dept/delete', { params: { id } });
}

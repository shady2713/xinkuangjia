/**
 * 系统用户 CRUD、重置密码、状态切换及 Excel 导入导出接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';
import type { PageParam, PageResult } from '@/api/request';

import { request } from '@/api/request';

export type UserItem = OpenApiSchemas.UserRespVO;
export type UserSaveReq = OpenApiSchemas.UserSaveReqVO;
export type UserSimple = OpenApiSchemas.UserSimpleRespVO;
export type UserImportResp = OpenApiSchemas.UserImportRespVO;

export function getUserPageApi(params: PageParam) {
  return request.get<PageResult<UserItem>>('/system/user/page', { params });
}

export function getUserApi(id: number | string) {
  return request.get<UserItem>('/system/user/get', { params: { id } });
}

export function createUserApi(data: UserSaveReq) {
  return request.post<number | string>('/system/user/create', data);
}

export function updateUserApi(data: UserSaveReq) {
  return request.put<boolean>('/system/user/update', data);
}

export function deleteUserApi(id: number | string) {
  return request.delete<boolean>('/system/user/delete', { params: { id } });
}

export function deleteUserListApi(ids: (number | string)[]) {
  return request.delete<boolean>(`/system/user/delete-list?ids=${ids.join(',')}`);
}

export function updateUserStatusApi(id: number | string, status: number) {
  return request.put<boolean>('/system/user/update-status', { id, status });
}

export function resetUserPasswordApi(id: number | string, password: string) {
  return request.put<boolean>('/system/user/update-password', { id, password });
}

export function exportUserApi(params: PageParam) {
  return request.download('/system/user/export-excel', { params });
}

export function getImportUserTemplateApi() {
  return request.download('/system/user/get-import-template');
}

export function importUserApi(file: File, updateSupport: boolean) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('updateSupport', String(updateSupport));
  return request.upload<UserImportResp>('/system/user/import', formData);
}

export function getSimpleUserListApi() {
  return request.get<UserSimple[]>('/system/user/simple-list');
}

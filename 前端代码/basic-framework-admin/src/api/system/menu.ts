/**
 * 菜单管理接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';

import { request } from '@/api/request';

export type MenuItem = OpenApiSchemas.MenuRespVO;
export type MenuSimple = OpenApiSchemas.MenuSimpleRespVO;
export type MenuSaveReq = OpenApiSchemas.MenuSaveVO;

export function getMenuListApi(params?: OpenApiSchemas.MenuListReqVO) {
  return request.get<MenuItem[]>('/system/menu/list', { params });
}

export function getSimpleMenuListApi() {
  return request.get<MenuSimple[]>('/system/menu/simple-list');
}

export function getMenuApi(id: number | string) {
  return request.get<MenuItem>('/system/menu/get', { params: { id } });
}

export function createMenuApi(data: MenuSaveReq) {
  return request.post<number | string>('/system/menu/create', data);
}

export function updateMenuApi(data: MenuSaveReq) {
  return request.put<boolean>('/system/menu/update', data);
}

export function deleteMenuApi(id: number | string) {
  return request.delete<boolean>('/system/menu/delete', { params: { id } });
}

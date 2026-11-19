/**
 * 菜单管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemMenuApi {
  /** 菜单信息（源自后端 MenuRespVO 契约） */
  export type Menu = Omit<OpenApiSchemas.MenuRespVO, 'id'> & {
    id?: number | string;
  };
}

/**
 * 查询菜单精简列表。
 *
 * @returns 菜单精简列表
 */
export async function getSimpleMenusList() {
  return requestClient.get<OpenApiSchemas.MenuSimpleRespVO[]>(
    '/system/menu/simple-list',
  );
}

/**
 * 查询菜单列表。
 *
 * @param params 筛选参数
 * @returns 菜单列表
 */
export async function getMenuList(params?: OpenApiSchemas.MenuListReqVO) {
  return requestClient.get<SystemMenuApi.Menu[]>('/system/menu/list', {
    params,
  });
}

/**
 * 获取菜单详情。
 *
 * @param id 菜单编号
 * @returns 菜单详情
 */
export async function getMenu(id: number | string) {
  return requestClient.get<SystemMenuApi.Menu>(`/system/menu/get?id=${id}`);
}

/**
 * 新增菜单。
 *
 * @param data 菜单保存请求
 * @returns 新建菜单编号
 */
export async function createMenu(data: OpenApiSchemas.MenuSaveVO) {
  return requestClient.post('/system/menu/create', data);
}

/**
 * 修改菜单。
 *
 * @param data 菜单保存请求
 * @returns 修改结果
 */
export async function updateMenu(data: OpenApiSchemas.MenuSaveVO) {
  return requestClient.put('/system/menu/update', data);
}

/**
 * 删除单个菜单。
 *
 * @param id 菜单编号
 * @returns 删除结果
 */
export async function deleteMenu(id: number | string) {
  return requestClient.delete(`/system/menu/delete?id=${id}`);
}

/**
 * 批量删除菜单。
 *
 * @param ids 菜单编号集合
 * @returns 批量删除结果
 */
export async function deleteMenuList(ids: (number | string)[]) {
  return requestClient.delete(`/system/menu/delete-list?ids=${ids.join(',')}`);
}

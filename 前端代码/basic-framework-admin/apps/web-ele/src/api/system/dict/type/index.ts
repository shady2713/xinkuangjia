/**
 * 字典类型管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemDictTypeApi {
  /** 字典类型信息（源自后端 DictTypeRespVO 契约） */
  export type DictType = Omit<OpenApiSchemas.DictTypeRespVO, 'id'> & {
    id?: number | string;
  };
}

export { getSimpleDictTypeList } from '#/api/core/dict';

/**
 * 分页查询字典类型列表。
 *
 * @param params 分页与筛选参数
 * @returns 字典类型分页结果
 */
export function getDictTypePage(params: PageParam) {
  return requestClient.get<PageResult<SystemDictTypeApi.DictType>>(
    '/system/dict-type/page',
    { params },
  );
}

/**
 * 查询字典类型详情。
 *
 * @param id 字典类型编号
 * @returns 字典类型详情
 */
export function getDictType(id: number | string) {
  return requestClient.get<SystemDictTypeApi.DictType>(
    `/system/dict-type/get?id=${id}`,
  );
}

/**
 * 新增字典类型。
 *
 * @param data 字典类型保存请求
 * @returns 新建字典类型编号
 */
export function createDictType(data: OpenApiSchemas.DictTypeSaveReqVO) {
  return requestClient.post('/system/dict-type/create', data);
}

/**
 * 修改字典类型。
 *
 * @param data 字典类型保存请求
 * @returns 修改结果
 */
export function updateDictType(data: OpenApiSchemas.DictTypeSaveReqVO) {
  return requestClient.put('/system/dict-type/update', data);
}

/**
 * 删除单个字典类型。
 *
 * @param id 字典类型编号
 * @returns 删除结果
 */
export function deleteDictType(id: number | string) {
  return requestClient.delete(`/system/dict-type/delete?id=${id}`);
}

/**
 * 批量删除字典类型。
 *
 * @param ids 字典类型编号集合
 * @returns 批量删除结果
 */
export function deleteDictTypeList(ids: (number | string)[]) {
  return requestClient.delete(
    `/system/dict-type/delete-list?ids=${ids.join(',')}`,
  );
}

/**
 * 字典数据管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemDictDataApi {
  /** 字典数据信息（源自后端 DictDataRespVO 契约） */
  export type DictData = Omit<OpenApiSchemas.DictDataRespVO, 'id'> & {
    id?: number | string;
  };
}

/**
 * 查询字典数据精简列表。
 *
 * @returns 字典数据精简列表
 */
export function getSimpleDictDataList() {
  return requestClient.get<OpenApiSchemas.DictDataSimpleRespVO[]>(
    '/system/dict-data/simple-list',
  );
}

/**
 * 分页查询字典数据列表。
 *
 * @param params 分页与筛选参数
 * @returns 字典数据分页结果
 */
export function getDictDataPage(params: PageParam) {
  return requestClient.get<PageResult<SystemDictDataApi.DictData>>(
    '/system/dict-data/page',
    { params },
  );
}

/**
 * 查询字典数据详情。
 *
 * @param id 字典数据编号
 * @returns 字典数据详情
 */
export function getDictData(id: number | string) {
  return requestClient.get<SystemDictDataApi.DictData>(
    `/system/dict-data/get?id=${id}`,
  );
}

/**
 * 新增字典数据。
 *
 * @param data 字典数据保存请求
 * @returns 新建字典数据编号
 */
export function createDictData(data: OpenApiSchemas.DictDataSaveReqVO) {
  return requestClient.post('/system/dict-data/create', data);
}

/**
 * 修改字典数据。
 *
 * @param data 字典数据保存请求
 * @returns 修改结果
 */
export function updateDictData(data: OpenApiSchemas.DictDataSaveReqVO) {
  return requestClient.put('/system/dict-data/update', data);
}

/**
 * 删除单个字典数据。
 *
 * @param id 字典数据编号
 * @returns 删除结果
 */
export function deleteDictData(id: number | string) {
  return requestClient.delete(`/system/dict-data/delete?id=${id}`);
}

/**
 * 批量删除字典数据。
 *
 * @param ids 字典数据编号集合
 * @returns 批量删除结果
 */
export function deleteDictDataList(ids: (number | string)[]) {
  return requestClient.delete(
    `/system/dict-data/delete-list?ids=${ids.join(',')}`,
  );
}

/**
 * 导出字典数据 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportDictData(params: PageParam) {
  return requestClient.download('/system/dict-data/export-excel', { params });
}

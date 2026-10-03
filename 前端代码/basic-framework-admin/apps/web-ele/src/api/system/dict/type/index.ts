/**
 * 字典类型接口：分页、增删改查与导出。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../../typing';

import { requestClient } from '#/api/request';

export namespace SystemDictTypeApi {
  /** 字典类型 */
  export type DictType = {
    createTime: Date;
    id?: number;
    name: string;
    remark: string;
    status: number;
    type: string;
  };
}

/**
 * 查询全部字典类型的精简列表，用于下拉选择。
 * @returns 字典类型的精简列表，不含详情字段。
 */
export function getSimpleDictTypeList() {
  return requestClient.get<SystemDictTypeApi.DictType[]>(
    '/system/dict-type/list-all-simple',
  );
}

/**
 * 分页查询字典类型列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含字典类型记录列表与总条数。
 */
export function getDictTypePage(params: PageParam) {
  return requestClient.get<PageResult<SystemDictTypeApi.DictType>>(
    '/system/dict-type/page',
    { params },
  );
}

/**
 * 按主键查询单个字典类型。
 * @param id 目标字典类型的主键。
 * @returns 字典类型详情。
 */
export function getDictType(id: number) {
  return requestClient.get<SystemDictTypeApi.DictType>(
    `/system/dict-type/get?id=${id}`,
  );
}

/**
 * 新增字典类型。
 * @param data 待保存的字典类型数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function createDictType(data: SystemDictTypeApi.DictType) {
  return requestClient.post('/system/dict-type/create', data);
}

/**
 * 修改字典类型。
 * @param data 待保存的字典类型数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateDictType(data: SystemDictTypeApi.DictType) {
  return requestClient.put('/system/dict-type/update', data);
}

/**
 * 删除指定字典类型。
 * @param id 目标字典类型的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteDictType(id: number) {
  return requestClient.delete(`/system/dict-type/delete?id=${id}`);
}

/**
 * 批量删除字典类型。
 * @param ids 待批量操作的字典类型主键集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteDictTypeList(ids: number[]) {
  return requestClient.delete(
    `/system/dict-type/delete-list?ids=${ids.join(',')}`,
  );
}

/**
 * 按当前筛选条件导出字典类型，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportDictType(params: ExportQuery) {
  return requestClient.download('/system/dict-type/export-excel', { params });
}

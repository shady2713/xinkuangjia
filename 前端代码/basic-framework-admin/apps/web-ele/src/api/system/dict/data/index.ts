/**
 * 字典数据接口：分页、增删改查与导出。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../../typing';

import { requestClient } from '#/api/request';

export namespace SystemDictDataApi {
  /** 字典数据 */
  export type DictData = {
    colorType: string;
    createTime: Date;
    cssClass: string;
    dictType: string;
    id?: number;
    label: string;
    remark: string;
    sort?: number;
    status: number;
    value: string;
  };
}

/**
 * 查询全部字典数据的精简列表，用于下拉选择。
 * @returns 字典数据的精简列表，不含详情字段。
 */
export function getSimpleDictDataList() {
  return requestClient.get<SystemDictDataApi.DictData[]>(
    '/system/dict-data/simple-list',
  );
}

/**
 * 分页查询字典数据列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含字典数据记录列表与总条数。
 */
export function getDictDataPage(params: PageParam) {
  return requestClient.get<PageResult<SystemDictDataApi.DictData>>(
    '/system/dict-data/page',
    { params },
  );
}

/**
 * 按主键查询单个字典数据。
 * @param id 目标字典数据的主键。
 * @returns 字典数据详情。
 */
export function getDictData(id: number) {
  return requestClient.get<SystemDictDataApi.DictData>(
    `/system/dict-data/get?id=${id}`,
  );
}

/**
 * 新增字典数据。
 * @param data 待保存的字典数据数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function createDictData(data: SystemDictDataApi.DictData) {
  return requestClient.post('/system/dict-data/create', data);
}

/**
 * 修改字典数据。
 * @param data 待保存的字典数据数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateDictData(data: SystemDictDataApi.DictData) {
  return requestClient.put('/system/dict-data/update', data);
}

/**
 * 删除指定字典数据。
 * @param id 目标字典数据的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteDictData(id: number) {
  return requestClient.delete(`/system/dict-data/delete?id=${id}`);
}

/**
 * 批量删除字典数据。
 * @param ids 待批量操作的字典数据主键集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteDictDataList(ids: number[]) {
  return requestClient.delete(
    `/system/dict-data/delete-list?ids=${ids.join(',')}`,
  );
}

/**
 * 按当前筛选条件导出字典数据，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportDictData(params: ExportQuery) {
  return requestClient.download('/system/dict-data/export-excel', { params });
}

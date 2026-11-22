/**
 * 字典类型与字典数据接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';
import type { PageParam, PageResult } from '@/api/request';

import { request } from '@/api/request';

export type DictTypeItem = OpenApiSchemas.DictTypeRespVO;
export type DictTypeSaveReq = OpenApiSchemas.DictTypeSaveReqVO;
export type DictDataItem = OpenApiSchemas.DictDataRespVO;
export type DictDataSimple = OpenApiSchemas.DictDataSimpleRespVO;
export type DictDataSaveReq = OpenApiSchemas.DictDataSaveReqVO;

export function getSimpleDictDataListApi() {
  return request.get<DictDataSimple[]>('/system/dict-data/simple-list');
}

export function getDictTypePageApi(params: PageParam) {
  return request.get<PageResult<DictTypeItem>>('/system/dict-type/page', { params });
}

export function getDictTypeApi(id: number | string) {
  return request.get<DictTypeItem>('/system/dict-type/get', { params: { id } });
}

export function createDictTypeApi(data: DictTypeSaveReq) {
  return request.post<number | string>('/system/dict-type/create', data);
}

export function updateDictTypeApi(data: DictTypeSaveReq) {
  return request.put<boolean>('/system/dict-type/update', data);
}

export function deleteDictTypeApi(id: number | string) {
  return request.delete<boolean>('/system/dict-type/delete', { params: { id } });
}

export function deleteDictTypeListApi(ids: (number | string)[]) {
  return request.delete<boolean>(
    `/system/dict-type/delete-list?ids=${ids.join(',')}`,
  );
}

export function getDictDataPageApi(params: PageParam) {
  return request.get<PageResult<DictDataItem>>('/system/dict-data/page', { params });
}

export function getDictDataApi(id: number | string) {
  return request.get<DictDataItem>('/system/dict-data/get', { params: { id } });
}

export function createDictDataApi(data: DictDataSaveReq) {
  return request.post<number | string>('/system/dict-data/create', data);
}

export function updateDictDataApi(data: DictDataSaveReq) {
  return request.put<boolean>('/system/dict-data/update', data);
}

export function deleteDictDataApi(id: number | string) {
  return request.delete<boolean>('/system/dict-data/delete', { params: { id } });
}

export function deleteDictDataListApi(ids: (number | string)[]) {
  return request.delete<boolean>(
    `/system/dict-data/delete-list?ids=${ids.join(',')}`,
  );
}

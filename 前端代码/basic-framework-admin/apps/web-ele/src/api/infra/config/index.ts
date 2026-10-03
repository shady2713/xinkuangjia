/**
 * 参数配置接口：分页、按键查询、增删改查与导出。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace InfraConfigApi {
  /** 参数配置信息 */
  export interface Config {
    id?: number;
    category: string;
    name: string;
    key: string;
    value: string;
    type: number;
    visible: boolean;
    remark: string;
    createTime?: Date;
  }
}

/**
 * 分页查询参数配置列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含参数配置记录列表与总条数。
 */
export function getConfigPage(params: PageParam) {
  return requestClient.get<PageResult<InfraConfigApi.Config>>(
    '/infra/config/page',
    {
      params,
    },
  );
}

/**
 * 按主键查询单个参数配置。
 * @param id 目标参数配置的主键。
 * @returns 参数配置详情。
 */
export function getConfig(id: number) {
  return requestClient.get<InfraConfigApi.Config>(`/infra/config/get?id=${id}`);
}

/**
 * 按配置键查询单个参数配置值。
 * @param configKey 配置项的键名，需与参数配置中登记的键完全一致。
 * @returns 配置值；键不存在时后端返回空值。
 */
export function getConfigKey(configKey: string) {
  return requestClient.get<string>(
    `/infra/config/get-value-by-key?key=${configKey}`,
  );
}

/**
 * 新增参数配置。
 * @param data 待保存的参数配置数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function createConfig(data: InfraConfigApi.Config) {
  return requestClient.post('/infra/config/create', data);
}

/**
 * 修改参数配置。
 * @param data 待保存的参数配置数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateConfig(data: InfraConfigApi.Config) {
  return requestClient.put('/infra/config/update', data);
}

/**
 * 删除指定参数配置。
 * @param id 目标参数配置的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteConfig(id: number) {
  return requestClient.delete(`/infra/config/delete?id=${id}`);
}

/**
 * 批量删除参数配置。
 * @param ids 待批量操作的参数配置主键集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteConfigList(ids: number[]) {
  return requestClient.delete(`/infra/config/delete-list?ids=${ids.join(',')}`);
}

/**
 * 按当前筛选条件导出参数配置，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportConfig(params: ExportQuery) {
  return requestClient.download('/infra/config/export-excel', {
    params,
  });
}

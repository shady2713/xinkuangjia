/**
 * 基础设施参数配置接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace InfraConfigApi {
  /** 参数配置记录（源自后端 ConfigRespVO / ConfigSaveReqVO 契约） */
  export type Config = Omit<OpenApiSchemas.ConfigRespVO, 'id'> &
    Partial<OpenApiSchemas.ConfigSaveReqVO> & {
      id?: number | string;
    };
}

/**
 * 分页查询参数配置列表。
 *
 * @param params 分页与筛选参数
 * @returns 参数配置分页结果
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
 * 查询参数配置详情。
 *
 * @param id 参数配置编号
 * @returns 参数配置详情
 */
export function getConfig(id: number | string) {
  return requestClient.get<InfraConfigApi.Config>(`/infra/config/get?id=${id}`);
}

/**
 * 新增参数配置。
 *
 * @param data 参数配置提交体
 * @returns 新建参数编号
 */
export function createConfig(data: OpenApiSchemas.ConfigSaveReqVO) {
  return requestClient.post('/infra/config/create', data);
}

/**
 * 修改参数配置。
 *
 * @param data 参数配置提交体
 * @returns 修改结果
 */
export function updateConfig(data: OpenApiSchemas.ConfigSaveReqVO) {
  return requestClient.put('/infra/config/update', data);
}

/**
 * 删除单条参数配置。
 *
 * @param id 参数配置编号
 * @returns 删除结果
 */
export function deleteConfig(id: number | string) {
  return requestClient.delete(`/infra/config/delete?id=${id}`);
}

/**
 * 批量删除参数配置。
 *
 * @param ids 参数配置编号集合
 * @returns 批量删除结果
 */
export function deleteConfigList(ids: (number | string)[]) {
  return requestClient.delete(`/infra/config/delete-list?ids=${ids.join(',')}`);
}

/**
 * 导出参数配置 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportConfig(params: PageParam) {
  return requestClient.download('/infra/config/export-excel', {
    params,
  });
}

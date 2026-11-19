/**
 * 操作日志接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemOperateLogApi {
  /** 操作日志信息（源自后端 OperateLogRespVO 契约） */
  export type OperateLog = OpenApiSchemas.OperateLogRespVO;
}

/**
 * 分页查询操作日志列表。
 *
 * @param params 分页与筛选参数
 * @returns 操作日志分页结果
 */
export function getOperateLogPage(params: PageParam) {
  return requestClient.get<PageResult<SystemOperateLogApi.OperateLog>>(
    '/system/operate-log/page',
    { params },
  );
}

/**
 * 导出操作日志 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportOperateLog(params: PageParam) {
  return requestClient.download('/system/operate-log/export-excel', { params });
}

/**
 * 定时任务执行日志接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace InfraJobLogApi {
  /** 任务执行日志信息（源自后端 JobLogRespVO 契约） */
  export type JobLog = Omit<OpenApiSchemas.JobLogRespVO, 'id'> & {
    id?: number | string;
  };
}

/**
 * 分页查询任务日志列表。
 *
 * @param params 分页与筛选参数
 * @returns 任务日志分页结果
 */
export function getJobLogPage(params: PageParam) {
  return requestClient.get<PageResult<InfraJobLogApi.JobLog>>(
    '/infra/job-log/page',
    { params },
  );
}

/**
 * 查询任务日志详情。
 *
 * @param id 日志编号
 * @returns 任务日志详情
 */
export function getJobLog(id: number | string) {
  return requestClient.get<InfraJobLogApi.JobLog>(
    `/infra/job-log/get?id=${id}`,
  );
}

/**
 * 导出定时任务日志 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportJobLog(params: PageParam) {
  return requestClient.download('/infra/job-log/export-excel', { params });
}

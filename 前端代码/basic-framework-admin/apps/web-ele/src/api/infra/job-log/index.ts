/**
 * 定时任务日志接口：分页查询与按条件导出。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace InfraJobLogApi {
  /** 任务日志信息 */
  export interface JobLog {
    id?: number;
    jobId: number;
    handlerName: string;
    handlerParam: string;
    cronExpression: string;
    executeIndex: string;
    beginTime: Date;
    endTime: Date;
    duration: string;
    status: number;
    createTime?: string;
    result: string;
  }
}

/**
 * 分页查询定时任务日志列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含定时任务日志记录列表与总条数。
 */
export function getJobLogPage(params: PageParam) {
  return requestClient.get<PageResult<InfraJobLogApi.JobLog>>(
    '/infra/job-log/page',
    { params },
  );
}

/**
 * 按主键查询单个定时任务日志。
 * @param id 目标定时任务日志的主键。
 * @returns 定时任务日志详情。
 */
export function getJobLog(id: number) {
  return requestClient.get<InfraJobLogApi.JobLog>(
    `/infra/job-log/get?id=${id}`,
  );
}

/**
 * 按当前筛选条件导出定时任务日志，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportJobLog(params: ExportQuery) {
  return requestClient.download('/infra/job-log/export-excel', { params });
}

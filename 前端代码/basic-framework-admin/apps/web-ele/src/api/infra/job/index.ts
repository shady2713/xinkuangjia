/**
 * 基础设施定时任务接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace InfraJobApi {
  /** 定时任务信息（源自后端 JobRespVO 契约） */
  export type Job = Omit<OpenApiSchemas.JobRespVO, 'id'> & {
    id?: number | string;
    nextTimes?: number[];
  };
}

/**
 * 分页查询定时任务列表。
 *
 * @param params 分页与筛选参数
 * @returns 定时任务分页结果
 */
export function getJobPage(params: PageParam) {
  return requestClient.get<PageResult<InfraJobApi.Job>>('/infra/job/page', {
    params,
  });
}

/**
 * 查询定时任务详情。
 *
 * @param id 任务编号
 * @returns 定时任务详情
 */
export function getJob(id: number | string) {
  return requestClient.get<InfraJobApi.Job>(`/infra/job/get?id=${id}`);
}

/**
 * 新增定时任务。
 *
 * @param data 定时任务保存参数
 * @returns 新建任务编号
 */
export function createJob(data: OpenApiSchemas.JobSaveReqVO) {
  return requestClient.post('/infra/job/create', data);
}

/**
 * 修改定时任务调度。
 *
 * @param data 定时任务保存参数
 * @returns 修改结果
 */
export function updateJob(data: OpenApiSchemas.JobSaveReqVO) {
  return requestClient.put('/infra/job/update', data);
}

/**
 * 删除单条定时任务。
 *
 * @param id 任务编号
 * @returns 删除结果
 */
export function deleteJob(id: number | string) {
  return requestClient.delete(`/infra/job/delete?id=${id}`);
}

/**
 * 批量删除定时任务。
 *
 * @param ids 任务编号集合
 * @returns 批量删除结果
 */
export function deleteJobList(ids: (number | string)[]) {
  return requestClient.delete(`/infra/job/delete-list?ids=${ids.join(',')}`);
}

/**
 * 导出定时任务 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportJob(params: PageParam) {
  return requestClient.download('/infra/job/export-excel', { params });
}

/**
 * 修改定时任务启用/暂停状态。
 *
 * @param id 任务编号
 * @param status 目标状态
 * @returns 更新结果
 */
export function updateJobStatus(id: number | string, status: number) {
  return requestClient.put('/infra/job/update-status', undefined, {
    params: {
      id,
      status,
    },
  });
}

/**
 * 立即触发一次定时任务。
 *
 * @param id 任务编号
 * @returns 触发结果
 */
export function runJob(id: number | string) {
  return requestClient.put(`/infra/job/trigger?id=${id}`);
}

/**
 * 获得定时任务的下 n 次执行时间列表。
 *
 * @param id 任务编号
 * @returns 毫秒时间戳数组
 */
export function getJobNextTimes(id: number | string) {
  return requestClient.get<number[]>(`/infra/job/get_next_times?id=${id}`);
}

/**
 * 定时任务接口：分页、增删改查、状态切换与手动触发。
 */
/** 定时任务接口及后续执行时间的实际毫秒传输契约。 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace InfraJobApi {
  /** 任务信息 */
  export interface Job {
    id?: number;
    name: string;
    status: number;
    handlerName: string;
    handlerParam: string;
    cronExpression: string;
    retryCount: number;
    retryInterval: number;
    monitorTimeout: number;
    createTime?: Date;
    nextTimes?: number[];
  }
}

/**
 * 分页查询定时任务列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含定时任务记录列表与总条数。
 */
export function getJobPage(params: PageParam) {
  return requestClient.get<PageResult<InfraJobApi.Job>>('/infra/job/page', {
    params,
  });
}

/**
 * 按主键查询单个定时任务。
 * @param id 目标定时任务的主键。
 * @returns 定时任务详情。
 */
export function getJob(id: number) {
  return requestClient.get<InfraJobApi.Job>(`/infra/job/get?id=${id}`);
}

/**
 * 新增定时任务。
 * @param data 待保存的定时任务数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function createJob(data: InfraJobApi.Job) {
  return requestClient.post('/infra/job/create', data);
}

/**
 * 修改定时任务。
 * @param data 待保存的定时任务数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateJob(data: InfraJobApi.Job) {
  return requestClient.put('/infra/job/update', data);
}

/**
 * 删除指定定时任务。
 * @param id 目标定时任务的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteJob(id: number) {
  return requestClient.delete(`/infra/job/delete?id=${id}`);
}

/**
 * 批量删除定时任务。
 * @param ids 待批量操作的定时任务主键集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteJobList(ids: number[]) {
  return requestClient.delete(`/infra/job/delete-list?ids=${ids.join(',')}`);
}

/**
 * 按当前筛选条件导出定时任务，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportJob(params: ExportQuery) {
  return requestClient.download('/infra/job/export-excel', { params });
}

/**
 * 更新定时任务的启用状态。
 * @param id 目标定时任务的主键。
 * @param status 目标定时任务状态值，取值见业务状态枚举。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateJobStatus(id: number, status: number) {
  return requestClient.put('/infra/job/update-status', undefined, {
    params: {
      id,
      status,
    },
  });
}

/**
 * 立即触发一次定时任务，不等待执行周期。
 * @param id 目标定时任务的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function runJob(id: number) {
  return requestClient.put(`/infra/job/trigger?id=${id}`);
}

/** 获得并验证定时任务的后续执行毫秒时间。
 * @param id 定时任务编号。
 * @returns 安全整数表示的毫秒时间数组，任务不存在时为空。
 * @throws {TypeError} 后端未返回毫秒时间数组。
 */
export async function getJobNextTimes(id: number): Promise<number[]> {
  const result = await requestClient.get<unknown>(
    `/infra/job/get_next_times?id=${id}`,
  );
  if (!Array.isArray(result)) throw new TypeError('后续执行时间必须是数组');
  return result.map(
    /** 每个时间都必须符合 LocalDateTime 的毫秒序列化。
     * @param value 尚未校验的单个执行时间。
     * @returns 有效的毫秒整数。
     * @throws {TypeError} 字符串、对象或不安全数值不属于时间契约。
     */ (value: unknown) => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        throw new TypeError('执行时间必须是毫秒整数');
      return value;
    },
  );
}

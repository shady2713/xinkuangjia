/**
 * 操作日志接口：分页查询与按条件导出。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace SystemOperateLogApi {
  /** 操作日志信息 */
  export interface OperateLog {
    id: number;
    traceId: string;
    userType: number;
    userId: number;
    userName: string;
    type: string;
    subType: string;
    bizId: number;
    action: string;
    extra: string;
    requestMethod: string;
    requestUrl: string;
    userIp: string;
    userAgent: string;
    creator: string;
    creatorName: string;
    createTime: string;
  }
}

/**
 * 分页查询操作日志列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含操作日志记录列表与总条数。
 */
export function getOperateLogPage(params: PageParam) {
  return requestClient.get<PageResult<SystemOperateLogApi.OperateLog>>(
    '/system/operate-log/page',
    { params },
  );
}

/**
 * 按当前筛选条件导出操作日志，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportOperateLog(params: ExportQuery) {
  return requestClient.download('/system/operate-log/export-excel', { params });
}

/**
 * 登录日志接口：分页查询与按条件导出。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace SystemLoginLogApi {
  /** 登录日志信息 */
  export interface LoginLog {
    id: number;
    logType: number;
    traceId: number;
    userId: number;
    userType: number;
    username: string;
    result: number;
    status: number;
    userIp: string;
    userAgent: string;
    createTime: string;
  }
}

/**
 * 分页查询登录日志列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含登录日志记录列表与总条数。
 */
export function getLoginLogPage(params: PageParam) {
  return requestClient.get<PageResult<SystemLoginLogApi.LoginLog>>(
    '/system/login-log/page',
    { params },
  );
}

/**
 * 按当前筛选条件导出登录日志，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportLoginLog(params: ExportQuery) {
  return requestClient.download('/system/login-log/export-excel', { params });
}

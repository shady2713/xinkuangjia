/**
 * 登录日志接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemLoginLogApi {
  /** 登录日志信息（源自后端 LoginLogRespVO 契约） */
  export type LoginLog = OpenApiSchemas.LoginLogRespVO;
}

/**
 * 分页查询登录日志列表。
 *
 * @param params 分页与筛选参数
 * @returns 登录日志分页结果
 */
export function getLoginLogPage(params: PageParam) {
  return requestClient.get<PageResult<SystemLoginLogApi.LoginLog>>(
    '/system/login-log/page',
    { params },
  );
}

/**
 * 导出登录日志 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportLoginLog(params: PageParam) {
  return requestClient.download('/system/login-log/export-excel', { params });
}

/**
 * 登录审计日志与操作审计日志接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';
import type { PageParam, PageResult } from '@/api/request';

import { request } from '@/api/request';

export type LoginLogItem = OpenApiSchemas.LoginLogRespVO;
export type OperateLogItem = OpenApiSchemas.OperateLogRespVO;

export function getLoginLogPageApi(params: PageParam) {
  return request.get<PageResult<LoginLogItem>>('/system/login-log/page', {
    params,
  });
}

export function exportLoginLogApi(params: PageParam) {
  return request.download('/system/login-log/export-excel', { params });
}

export function getOperateLogPageApi(params: PageParam) {
  return request.get<PageResult<OperateLogItem>>('/system/operate-log/page', {
    params,
  });
}

export function exportOperateLogApi(params: PageParam) {
  return request.download('/system/operate-log/export-excel', { params });
}

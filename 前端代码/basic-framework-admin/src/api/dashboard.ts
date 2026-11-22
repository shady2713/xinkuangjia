import type { OpenApiSchemas } from '@/api/generated/api-types';
import { request } from '@/api/request';

export type DashboardSummaryRespVO = OpenApiSchemas.DashboardSummaryRespVO;
export type DailyTrendItem = NonNullable<DashboardSummaryRespVO['dailyTrend']>[number];
export type RecentLoginItem = NonNullable<DashboardSummaryRespVO['recentLogins']>[number];
export type RecentOperateItem = NonNullable<DashboardSummaryRespVO['recentOperates']>[number];

/** 获取当前登录管理员所属平台的概览统计摘要 */
export function getDashboardSummaryApi() {
  return request.get<DashboardSummaryRespVO>('/system/dashboard/summary');
}

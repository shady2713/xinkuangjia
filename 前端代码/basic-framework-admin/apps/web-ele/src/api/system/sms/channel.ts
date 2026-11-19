/**
 * 短信渠道管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemSmsChannelApi {
  /** 短信渠道（源自后端 SmsChannelRespVO 契约） */
  export type Channel = Omit<OpenApiSchemas.SmsChannelRespVO, 'id'> & {
    apiSecret?: string;
    id?: number | string;
  };
}

/**
 * 分页查询短信渠道列表。
 *
 * @param params 分页与筛选参数
 * @returns 短信渠道分页结果
 */
export function getSmsChannelPage(params: PageParam) {
  return requestClient.get<PageResult<SystemSmsChannelApi.Channel>>(
    '/system/sms-channel/page',
    { params },
  );
}

/**
 * 查询短信渠道详情。
 *
 * @param id 短信渠道编号
 * @returns 短信渠道详情
 */
export function getSmsChannel(id: number | string) {
  return requestClient.get<SystemSmsChannelApi.Channel>(
    `/system/sms-channel/get?id=${id}`,
  );
}

/**
 * 新增短信渠道。
 *
 * @param data 短信渠道保存请求
 * @returns 新建短信渠道编号
 */
export function createSmsChannel(data: OpenApiSchemas.SmsChannelSaveReqVO) {
  return requestClient.post('/system/sms-channel/create', data);
}

/**
 * 修改短信渠道。
 *
 * @param data 短信渠道保存请求
 * @returns 修改结果
 */
export function updateSmsChannel(data: OpenApiSchemas.SmsChannelSaveReqVO) {
  return requestClient.put('/system/sms-channel/update', data);
}

/**
 * 删除单个短信渠道。
 *
 * @param id 短信渠道编号
 * @returns 删除结果
 */
export function deleteSmsChannel(id: number | string) {
  return requestClient.delete(`/system/sms-channel/delete?id=${id}`);
}

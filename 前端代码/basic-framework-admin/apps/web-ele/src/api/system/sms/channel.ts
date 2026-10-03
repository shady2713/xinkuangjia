import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace SystemSmsChannelApi {
  /** 短信渠道 */
  export interface Channel {
    id?: number;
    code: string;
    status: number;
    signature: string;
    remark: string;
    apiKey: string;
    apiSecret: string;
    callbackUrl: string;
    createTime?: string;
  }
}

/** 查询短信渠道列表 */
export function getSmsChannelPage(params: PageParam) {
  return requestClient.get<PageResult<SystemSmsChannelApi.Channel>>(
    '/system/sms-channel/page',
    { params },
  );
}

/** 查询短信渠道详情 */
export function getSmsChannel(id: number) {
  return requestClient.get<SystemSmsChannelApi.Channel>(
    `/system/sms-channel/get?id=${id}`,
  );
}

/** 新增短信渠道 */
export function createSmsChannel(data: SystemSmsChannelApi.Channel) {
  return requestClient.post('/system/sms-channel/create', data);
}

/** 修改短信渠道 */
export function updateSmsChannel(data: SystemSmsChannelApi.Channel) {
  return requestClient.put('/system/sms-channel/update', data);
}

/** 删除短信渠道 */
export function deleteSmsChannel(id: number) {
  return requestClient.delete(`/system/sms-channel/delete?id=${id}`);
}

/**
 * 发送测试短信。
 * @param data 测试短信内容。
 * @param data.mobile 接收号码。
 * @param data.templateCode 模板编码。
 * @param data.templateParams 模板参数。
 * @returns 请求完成后兑现的 Promise；发送失败时按接口错误抛出。
 */
export function sendTestSms(data: {
  mobile: string;
  templateCode: string;
  templateParams: Record<string, object>;
}) {
  return requestClient.post('/system/sms-channel/test-sms', data);
}

/**
 * 短信渠道接口：渠道的分页查询、详情、增删改与测试短信发送。
 * 渠道密钥只在保存时上行，读取接口不返回；模板与按模板发送在 sms/template。
 */
import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace SystemSmsChannelApi {
  /**
   * 短信渠道响应模型。
   *
   * 读取接口不返回短信 API 密钥，因此这里没有 apiSecret 字段；创建与修改改传
   * {@link ChannelSaveReq}，避免把响应类型当作请求类型使用。
   */
  export interface Channel {
    id?: number;
    code: string;
    status: number;
    signature: string;
    remark: string;
    apiKey: string;
    callbackUrl: string;
    /** 创建时间；后端按毫秒时间戳序列化。 */
    createTime?: number;
  }

  /**
   * 新增/修改短信渠道的请求模型。
   *
   * apiSecret 只在提交时上行；编辑时留空表示保持服务端已保存的密钥不变，
   * 提交空值不会把已有密钥覆盖为空。
   */
  export interface ChannelSaveReq extends Omit<Channel, 'createTime'> {
    apiSecret?: string;
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

/**
 * 新增短信渠道。
 * @param data 渠道表单数据，含只在提交时上行的 API Secret
 * @returns 新建渠道的编号
 */
export function createSmsChannel(data: SystemSmsChannelApi.ChannelSaveReq) {
  return requestClient.post('/system/sms-channel/create', data);
}

/**
 * 修改短信渠道。
 * @param data 渠道表单数据；apiSecret 留空表示保持服务端已保存的密钥
 * @returns 更新结果
 */
export function updateSmsChannel(data: SystemSmsChannelApi.ChannelSaveReq) {
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

/**
 * 短信模板接口：模板的分页查询、详情、增删改与按模板发送短信。
 * 模板所属渠道由 sms/channel 维护，本模块只携带渠道编号与编码。
 */
import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace SystemSmsTemplateApi {
  /** 短信模板 */
  export interface Template {
    id?: number;
    type: number;
    status: number;
    code: string;
    name: string;
    content: string;
    params: string[];
    remark: string;
    apiTemplateId: string;
    channelId: number;
    channelCode: string;
    createTime?: string;
  }
}

/**
 * 分页查询短信模板。
 * @param params 分页与筛选条件，支持按类型、状态、模板编码、内容、供应商模板编号、所属渠道及创建时间区间过滤。
 * @returns 当前页的模板记录及总条数，含所属渠道编号与渠道编码。
 */
export function getSmsTemplatePage(params: PageParam) {
  return requestClient.get<PageResult<SystemSmsTemplateApi.Template>>(
    '/system/sms-template/page',
    { params },
  );
}

/**
 * 查询短信模板详情。
 * @param id 模板编号；编号不存在时后端按业务码拒绝。
 * @returns 模板完整配置，含模板内容、参数列表与供应商模板编号。
 */
export function getSmsTemplate(id: number) {
  return requestClient.get<SystemSmsTemplateApi.Template>(
    `/system/sms-template/get?id=${id}`,
  );
}

/**
 * 新增短信模板。
 * @param data 模板表单数据；后端校验所属渠道存在、模板编码不重复、供应商模板编号在该渠道下可用，
 *             并从模板内容中解析出参数列表回填，模板编号由后端生成。
 * @returns 新建模板的编号。
 */
export function createSmsTemplate(data: SystemSmsTemplateApi.Template) {
  return requestClient.post('/system/sms-template/create', data);
}

/**
 * 修改短信模板。
 * @param data 模板表单数据，必须携带已有模板编号；渠道、编码重复与供应商模板校验同新增，
 *             参数列表会按修改后的模板内容重新解析。
 * @returns 更新结果标识。
 */
export function updateSmsTemplate(data: SystemSmsTemplateApi.Template) {
  return requestClient.put('/system/sms-template/update', data);
}

/**
 * 删除短信模板。
 * @param id 模板编号；编号不存在时后端按业务码拒绝。
 * @returns 删除结果标识。
 */
export function deleteSmsTemplate(id: number) {
  return requestClient.delete(`/system/sms-template/delete?id=${id}`);
}

/**
 * 按模板发送短信。
 * @param data 短信内容。
 * @param data.mobile 接收号码。
 * @param data.templateCode 模板编码。
 * @param data.templateParams 模板参数。
 * @returns 请求完成后兑现的 Promise；发送失败时按接口错误抛出。
 */
export function sendSms(data: {
  mobile: string;
  templateCode: string;
  templateParams: Record<string, object>;
}) {
  return requestClient.post('/system/sms-template/send-sms', data);
}

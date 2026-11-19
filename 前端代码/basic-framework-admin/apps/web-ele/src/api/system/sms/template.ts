/**
 * 短信模板管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemSmsTemplateApi {
  /** 短信模板（源自后端 SmsTemplateRespVO 契约） */
  export type Template = Omit<OpenApiSchemas.SmsTemplateRespVO, 'id'> & {
    id?: number | string;
  };
}

/**
 * 分页查询短信模板列表。
 *
 * @param params 分页与筛选参数
 * @returns 短信模板分页结果
 */
export function getSmsTemplatePage(params: PageParam) {
  return requestClient.get<PageResult<SystemSmsTemplateApi.Template>>(
    '/system/sms-template/page',
    { params },
  );
}

/**
 * 查询短信模板详情。
 *
 * @param id 短信模板编号
 * @returns 短信模板详情
 */
export function getSmsTemplate(id: number | string) {
  return requestClient.get<SystemSmsTemplateApi.Template>(
    `/system/sms-template/get?id=${id}`,
  );
}

/**
 * 新增短信模板。
 *
 * @param data 短信模板保存请求
 * @returns 新建短信模板编号
 */
export function createSmsTemplate(data: OpenApiSchemas.SmsTemplateSaveReqVO) {
  return requestClient.post('/system/sms-template/create', data);
}

/**
 * 修改短信模板。
 *
 * @param data 短信模板保存请求
 * @returns 修改结果
 */
export function updateSmsTemplate(data: OpenApiSchemas.SmsTemplateSaveReqVO) {
  return requestClient.put('/system/sms-template/update', data);
}

/**
 * 删除单个短信模板。
 *
 * @param id 短信模板编号
 * @returns 删除结果
 */
export function deleteSmsTemplate(id: number | string) {
  return requestClient.delete(`/system/sms-template/delete?id=${id}`);
}

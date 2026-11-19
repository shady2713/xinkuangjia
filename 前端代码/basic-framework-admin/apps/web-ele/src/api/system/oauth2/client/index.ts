/**
 * OAuth2.0 客户端管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemOAuth2ClientApi {
  /** OAuth2.0 客户端信息（源自后端 OAuth2ClientRespVO 契约） */
  export type OAuth2Client = Omit<OpenApiSchemas.OAuth2ClientRespVO, 'id'> & {
    id?: number | string;
    isAdditionalInformationJson?: boolean;
    secret?: string;
  };
}

/**
 * 分页查询 OAuth2.0 客户端列表。
 *
 * @param params 分页与筛选参数
 * @returns 客户端分页结果
 */
export function getOAuth2ClientPage(params: PageParam) {
  return requestClient.get<PageResult<SystemOAuth2ClientApi.OAuth2Client>>(
    '/system/oauth2-client/page',
    { params },
  );
}

/**
 * 查询 OAuth2.0 客户端详情。
 *
 * @param id 客户端编号
 * @returns 客户端详情
 */
export function getOAuth2Client(id: number | string) {
  return requestClient.get<SystemOAuth2ClientApi.OAuth2Client>(
    `/system/oauth2-client/get?id=${id}`,
  );
}

/**
 * 新增 OAuth2.0 客户端。
 *
 * @param data 客户端保存请求
 * @returns 新建客户端编号
 */
export function createOAuth2Client(data: OpenApiSchemas.OAuth2ClientSaveReqVO) {
  return requestClient.post('/system/oauth2-client/create', data);
}

/**
 * 修改 OAuth2.0 客户端。
 *
 * @param data 客户端保存请求
 * @returns 修改结果
 */
export function updateOAuth2Client(data: OpenApiSchemas.OAuth2ClientSaveReqVO) {
  return requestClient.put('/system/oauth2-client/update', data);
}

/**
 * 删除单个 OAuth2.0 客户端。
 *
 * @param id 客户端编号
 * @returns 删除结果
 */
export function deleteOAuth2Client(id: number | string) {
  return requestClient.delete(`/system/oauth2-client/delete?id=${id}`);
}

/**
 * 批量删除 OAuth2.0 客户端。
 *
 * @param ids 客户端编号集合
 * @returns 批量删除结果
 */
export function deleteOAuth2ClientList(ids: (number | string)[]) {
  return requestClient.delete(
    `/system/oauth2-client/delete-list?ids=${ids.join(',')}`,
  );
}

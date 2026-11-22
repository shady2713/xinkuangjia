/**
 * OAuth2 开放客户端与在线令牌会话管理接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';
import type { PageParam, PageResult } from '@/api/request';

import { request } from '@/api/request';

export type OAuth2ClientItem = OpenApiSchemas.OAuth2ClientRespVO;
export type OAuth2ClientSaveReq = OpenApiSchemas.OAuth2ClientSaveReqVO;
export type OAuth2TokenItem = OpenApiSchemas.OAuth2AccessTokenRespVO;

export function getOAuth2ClientPageApi(params: PageParam) {
  return request.get<PageResult<OAuth2ClientItem>>('/system/oauth2-client/page', {
    params,
  });
}

export function getOAuth2ClientApi(id: number | string) {
  return request.get<OAuth2ClientItem>('/system/oauth2-client/get', {
    params: { id },
  });
}

export function createOAuth2ClientApi(data: OAuth2ClientSaveReq) {
  return request.post<number | string>('/system/oauth2-client/create', data);
}

export function updateOAuth2ClientApi(data: OAuth2ClientSaveReq) {
  return request.put<boolean>('/system/oauth2-client/update', data);
}

export function deleteOAuth2ClientApi(id: number | string) {
  return request.delete<boolean>('/system/oauth2-client/delete', {
    params: { id },
  });
}

export function deleteOAuth2ClientListApi(ids: (number | string)[]) {
  return request.delete<boolean>(
    `/system/oauth2-client/delete-list?ids=${ids.join(',')}`,
  );
}

export function getOAuth2TokenPageApi(params: PageParam) {
  return request.get<PageResult<OAuth2TokenItem>>('/system/oauth2-token/page', {
    params,
  });
}

export function deleteOAuth2TokenApi(id: number | string) {
  return request.delete<boolean>('/system/oauth2-token/delete', {
    params: { id },
  });
}

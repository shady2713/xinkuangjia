/**
 * OAuth2 客户端管理接口：客户端的增删改查与批量删除。
 * 授权确认与令牌查询分别由 oauth2/open、oauth2/token 提供，
 * 本模块只覆盖后台维护客户端的场景。
 */
import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace SystemOAuth2ClientApi {
  /** OAuth2.0 客户端信息 */
  export interface OAuth2Client {
    id?: number;
    clientId: string;
    secret: string;
    name: string;
    logo: string;
    description: string;
    status: number;
    accessTokenValiditySeconds: number;
    refreshTokenValiditySeconds: number;
    redirectUris: string[];
    autoApprove: boolean;
    authorizedGrantTypes: string[];
    scopes: string[];
    authorities: string[];
    resourceIds: string[];
    additionalInformation: string;
    isAdditionalInformationJson: boolean;
    createTime?: Date;
  }
}

/**
 * 分页查询 OAuth2.0 客户端。
 * @param params 分页与筛选条件，由客户端管理页按当前筛选表单拼装。
 * @returns 当前页的客户端记录及总条数；响应不含客户端密钥，只返回 clientId 等公开字段。
 */
export function getOAuth2ClientPage(params: PageParam) {
  return requestClient.get<PageResult<SystemOAuth2ClientApi.OAuth2Client>>(
    '/system/oauth2-client/page',
    { params },
  );
}

/**
 * 查询 OAuth2.0 客户端详情。
 * @param id 客户端记录编号，不是授权请求里的 clientId；编号不存在时后端按业务码拒绝。
 * @returns 客户端完整配置，含回调地址、授权类型、范围与有效期，不含已存储的密钥明文。
 */
export function getOAuth2Client(id: number) {
  return requestClient.get<SystemOAuth2ClientApi.OAuth2Client>(
    `/system/oauth2-client/get?id=${id}`,
  );
}

/**
 * 新增 OAuth2.0 客户端。
 * @param data 客户端表单数据；clientId 必须唯一，secret 为明文口令，由后端编码后存储且不再回显。
 * @returns 新建客户端的记录编号。
 */
export function createOAuth2Client(data: SystemOAuth2ClientApi.OAuth2Client) {
  return requestClient.post('/system/oauth2-client/create', data);
}

/**
 * 修改 OAuth2.0 客户端。
 * @param data 客户端表单数据，必须携带已有记录编号；重新提交 secret 会覆盖已存储的密钥。
 * @returns 更新结果标识。
 */
export function updateOAuth2Client(data: SystemOAuth2ClientApi.OAuth2Client) {
  return requestClient.put('/system/oauth2-client/update', data);
}

/**
 * 删除 OAuth2.0 客户端。
 * @param id 客户端记录编号；编号不存在时后端按业务码拒绝，已签发的令牌不在本次删除范围内。
 * @returns 删除结果标识。
 */
export function deleteOAuth2Client(id: number) {
  return requestClient.delete(`/system/oauth2-client/delete?id=${id}`);
}

/**
 * 批量删除 OAuth2.0 客户端。
 * @param ids 客户端记录编号数组，以逗号拼入查询串；后端直接按主键批量删除，不逐个校验存在性。
 * @returns 删除结果标识。
 */
export function deleteOAuth2ClientList(ids: number[]) {
  return requestClient.delete(
    `/system/oauth2-client/delete-list?ids=${ids.join(',')}`,
  );
}

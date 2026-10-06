/**
 * OAuth2 访问令牌接口：令牌的分页查询与按令牌值删除。
 * 只提供后台管理视角的查看与强制失效，令牌签发与刷新由认证接口负责。
 */
import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace SystemOAuth2TokenApi {
  /** OAuth2.0 令牌信息 */
  export interface OAuth2Token {
    id?: number;
    accessToken: string;
    refreshToken: string;
    userId: number;
    userType: number;
    clientId: string;
    createTime?: Date;
    expiresTime?: Date;
  }
}

/** 查询 OAuth2.0 令牌列表 */
export function getOAuth2TokenPage(params: PageParam) {
  return requestClient.get<PageResult<SystemOAuth2TokenApi.OAuth2Token>>(
    '/system/oauth2-token/page',
    {
      params,
    },
  );
}

/** 删除 OAuth2.0 令牌 */
export function deleteOAuth2Token(accessToken: string) {
  return requestClient.delete(
    `/system/oauth2-token/delete?accessToken=${accessToken}`,
  );
}

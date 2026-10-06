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

/**
 * 分页查询已签发的访问令牌。
 * @param params 分页与筛选条件，由令牌管理页按当前筛选表单拼装。
 * @returns 当前页的令牌记录及总条数，含所属用户、客户端与过期时间。
 */
export function getOAuth2TokenPage(params: PageParam) {
  return requestClient.get<PageResult<SystemOAuth2TokenApi.OAuth2Token>>(
    '/system/oauth2-token/page',
    {
      params,
    },
  );
}

/**
 * 按令牌值强制失效一个访问令牌，等价于管理员代替用户登出。
 * @param accessToken 要作废的访问令牌明文，以查询串上行；后端据此删除令牌记录并记录一条退出日志。
 * @returns 失效结果标识；令牌不存在时后端静默跳过，不会报错。
 */
export function deleteOAuth2Token(accessToken: string) {
  return requestClient.delete(
    `/system/oauth2-token/delete?accessToken=${accessToken}`,
  );
}

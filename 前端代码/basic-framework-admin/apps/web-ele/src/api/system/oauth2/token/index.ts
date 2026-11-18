import type { PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace SystemOAuth2TokenApi {
  /** OAuth2.0 会话令牌元数据（不暴露明文令牌串） */
  export interface OAuth2Token {
    id: number;
    userId: number;
    userType: number;
    clientId: string;
    createTime?: number;
    expiresTime?: number;
  }
}

/**
 * 查询 OAuth2.0 令牌分页列表。
 *
 * @param params 分页与筛选参数
 * @returns 令牌元数据分页结果
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
 * 按令牌记录主键吊销单条 OAuth2.0 令牌。
 *
 * @param id 令牌记录主键编号
 * @returns 吊销结果
 */
export function deleteOAuth2Token(id: number) {
  return requestClient.delete(`/system/oauth2-token/delete?id=${id}`);
}

/**
 * 按令牌记录主键集合批量吊销 OAuth2.0 令牌。
 *
 * @param ids 令牌记录主键编号集合
 * @returns 批量吊销结果
 */
export function deleteOAuth2TokenList(ids: number[]) {
  return requestClient.delete(
    `/system/oauth2-token/delete-list?ids=${ids.join(',')}`,
  );
}

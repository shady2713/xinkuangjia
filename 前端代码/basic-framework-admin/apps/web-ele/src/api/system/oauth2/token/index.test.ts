/**
 * OAuth2 令牌接口（api/system/oauth2/token）的地址与返回契约回归。
 *
 * 令牌管理页只做分页查询与按令牌删除：分页参数丢失会让列表停在默认页，删除接口的
 * 查询串参数名写错（accessToken）会让后端收不到目标令牌。用例只替换网络边界，
 * 接口自身的地址拼装与参数透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { deleteOAuth2Token, getOAuth2TokenPage } from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，保留接口自身的地址与参数拼装逻辑。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      get: vi.fn(),
    },
  }),
);

describe('令牌查询与删除', /** 令牌列表的分页参数与删除查询串是后端约定的直接体现。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的令牌范围，丢失会退化成默认首页。 */ async () => {
    const page = {
      list: [
        {
          accessToken: 'DUMMY-test-access',
          clientId: 'client-1',
          refreshToken: 'DUMMY-test-refresh',
          userId: 1,
          userType: 2,
        },
      ],
      total: 1,
    };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getOAuth2TokenPage({ pageNo: 4, pageSize: 10 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/oauth2-token/page',
      {
        params: { pageNo: 4, pageSize: 10 },
      },
    );
  });

  it('按令牌值删除并把它放进查询串', /** 查询串参数名必须是 accessToken，写错会删不掉目标令牌。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteOAuth2Token('DUMMY-test-access')).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/oauth2-token/delete?accessToken=DUMMY-test-access',
    );
  });
});

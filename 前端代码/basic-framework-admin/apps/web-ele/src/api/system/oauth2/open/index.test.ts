/**
 * OAuth2 授权接口（api/system/oauth2/open）的地址、参数与 scope 组装契约回归。
 *
 * 授权页先按 clientId 取客户端信息，再把用户勾选的 scope 组装成后端要求的 JSON 字符串
 * 发起授权：地址或请求方式写错会让授权页无法打开，scope 组装把勾选与取消勾选弄反会让
 * 用户拿到未申请的权限。用例只替换网络边界，接口自身的参数拼装与 scope 组装保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { authorize, getAuthorize } from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，保留接口自身的地址与参数拼装逻辑。 */ () => ({
    requestClient: {
      get: vi.fn(),
      post: vi.fn(),
    },
  }),
);

describe('授权信息查询与授权发起', /** 授权页依赖这两个入口的真实参数契约。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('按 clientId 查询授权信息', /** clientId 必须进入查询串，否则会展示其它客户端的信息。 */ async () => {
    const info = {
      client: { logo: '', name: '演示客户端' },
      scopes: [{ key: 'user.read', value: true }],
    };
    vi.mocked(requestClient.get).mockResolvedValue(info);

    await expect(getAuthorize('client-1')).resolves.toBe(info);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/oauth2/authorize?clientId=client-1',
    );
  });

  it('发起授权按勾选结果组装 scope 并提交表单参数', /** scope 的布尔值决定后端授予或拒绝权限，勾选与取消勾选不能写反。 */ async () => {
    vi.mocked(requestClient.post).mockResolvedValue('redirect-url');

    await expect(
      authorize(
        'code',
        'client-1',
        'https://example.test/callback',
        'state-1',
        true,
        ['user.read', 'user.write'],
        ['user.delete'],
      ),
    ).resolves.toBe('redirect-url');

    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/oauth2/authorize',
      null,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        params: {
          response_type: 'code',
          client_id: 'client-1',
          redirect_uri: 'https://example.test/callback',
          state: 'state-1',
          auto_approve: true,
          scope: JSON.stringify({
            'user.read': true,
            'user.write': true,
            'user.delete': false,
          }),
        },
      },
    );
  });

  it('同一 scope 同时出现在两个列表时按取消勾选处理', /** 取消勾选必须覆盖勾选，否则用户会拿到已经收回的权限。 */ async () => {
    vi.mocked(requestClient.post).mockResolvedValue('redirect-url');

    await authorize(
      'code',
      'client-1',
      '',
      '',
      false,
      ['user.read'],
      ['user.read'],
    );

    const lastCall = vi.mocked(requestClient.post).mock.calls.at(-1);
    if (!lastCall) throw new Error('未记录到授权请求');
    const options = lastCall[2] as { params: { scope: string } };
    expect(JSON.parse(options.params.scope)).toEqual({ 'user.read': false });
  });
});

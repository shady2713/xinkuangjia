/**
 * OAuth2.0 客户端接口（api/system/oauth2/client）的地址、方法与参数契约回归。
 *
 * 客户端管理页提供分页查询、详情、增删改与批量删除：地址或方法写错会把操作落到
 * 其它资源，详情与删除编号没拼进查询串会改错客户端，批量删除的编号分隔符写错会
 * 漏删或多删，而删除客户端会使第三方应用立刻失去授权。用例只替换网络收发边界，
 * 接口自身的地址拼装与参数透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createOAuth2Client,
  deleteOAuth2Client,
  deleteOAuth2ClientList,
  getOAuth2Client,
  getOAuth2ClientPage,
  updateOAuth2Client,
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，保留接口自身的地址与参数拼装逻辑。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  }),
);

/** 构造字段完整的 OAuth2.0 客户端记录，作为各用例的合法基线。 */
function validClient() {
  return {
    accessTokenValiditySeconds: 3600,
    additionalInformation: '{}',
    authorities: ['system:user:list'],
    autoApprove: false,
    authorizedGrantTypes: ['authorization_code'],
    clientId: 'DUMMY-client-id',
    description: '演示客户端',
    id: 9,
    isAdditionalInformationJson: true,
    logo: '',
    name: '演示应用',
    redirectUris: ['http://127.0.0.1:5173/admin/callback'],
    refreshTokenValiditySeconds: 86_400,
    resourceIds: ['system'],
    scopes: ['openid'],
    secret: 'DUMMY-client-secret',
    status: 0,
  };
}

describe('客户端查询（OAuth2.0）', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的客户端范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validClient()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(
      getOAuth2ClientPage({ pageNo: 1, pageSize: 10 }),
    ).resolves.toBe(page);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/oauth2-client/page',
      { params: { pageNo: 1, pageSize: 10 } },
    );
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会展示另一个客户端的密钥与回调地址。 */ async () => {
    const detail = validClient();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getOAuth2Client(9)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/oauth2-client/get?id=9',
    );
  });
});

describe('客户端写入（OAuth2.0）', /** 增删改的地址与方法决定操作落到哪个客户端。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增客户端使用 POST 提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据，字段漏传会写入不完整配置。 */ async () => {
    const payload = validClient();
    vi.mocked(requestClient.post).mockResolvedValue(9);

    await expect(createOAuth2Client(payload)).resolves.toBe(9);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/oauth2-client/create',
      payload,
    );
  });

  it('修改客户端使用 PUT 提交完整请求体', /** 修改与新增共用路径时必须靠方法区分，误用 POST 会创建重复客户端。 */ async () => {
    const payload = validClient();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateOAuth2Client(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/oauth2-client/update',
      payload,
    );
  });

  it('按编号删除单个客户端', /** 编号必须进入查询串，删错客户端会让无关应用失去授权。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteOAuth2Client(9)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/oauth2-client/delete?id=9',
    );
  });

  it('批量删除用逗号拼接编号', /** 分隔符由后端约定，写错会漏删或多删客户端。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteOAuth2ClientList([9, 10])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/oauth2-client/delete-list?ids=9,10',
    );
  });
});

/**
 * 短信渠道接口（api/system/sms/channel）的地址、方法与参数契约回归。
 *
 * 短信渠道页提供分页查询、详情、增删改与测试发送：地址或方法写错会把配置写到
 * 其它资源，删除编号没拼进查询串会停用错误的渠道，测试短信的接收号码与模板参数
 * 若被改写会让真实短信发给错误的号码并产生费用。用例只替换网络收发边界，
 * 接口自身的地址拼装与参数透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createSmsChannel,
  deleteSmsChannel,
  getSmsChannel,
  getSmsChannelPage,
  sendTestSms,
  updateSmsChannel,
} from './channel';

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

/** 构造字段完整的短信渠道记录，作为各用例的合法基线。 */
function validChannel() {
  return {
    apiKey: 'DUMMY-sms-key',
    apiSecret: 'DUMMY-sms-secret',
    callbackUrl: 'http://127.0.0.1:48080/admin-api/system/sms/callback/demo',
    code: 'DEMO',
    id: 5,
    remark: '演示渠道',
    signature: '演示签名',
    status: 0,
  };
}

describe('短信渠道查询', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的渠道范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validChannel()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getSmsChannelPage({ pageNo: 3, pageSize: 20 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith('/system/sms-channel/page', {
      params: { pageNo: 3, pageSize: 20 },
    });
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会展示另一个渠道的密钥与签名。 */ async () => {
    const detail = validChannel();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getSmsChannel(5)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/sms-channel/get?id=5',
    );
  });
});

describe('短信渠道维护', /** 增删改的地址与方法决定渠道配置的落库目标。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增渠道使用 POST 提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据，密钥漏传会让渠道无法发送。 */ async () => {
    const payload = validChannel();
    vi.mocked(requestClient.post).mockResolvedValue(5);

    await expect(createSmsChannel(payload)).resolves.toBe(5);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/sms-channel/create',
      payload,
    );
  });

  it('修改渠道使用 PUT 提交完整请求体', /** 修改与新增共用路径时必须靠方法区分，误用 POST 会创建重复渠道。 */ async () => {
    const payload = validChannel();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateSmsChannel(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/sms-channel/update',
      payload,
    );
  });

  it('按编号删除渠道', /** 编号必须进入查询串，删错渠道会让在用业务发不出短信。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteSmsChannel(5)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/sms-channel/delete?id=5',
    );
  });
});

describe('短信渠道测试发送', /** 测试短信会真实计费，接收号码与模板参数不能被改写。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('测试发送原样提交号码、模板与参数', /** 号码或模板被改写会把短信发给错误的人并产生费用。 */ async () => {
    const payload = {
      mobile: '13800000000',
      templateCode: 'DEMO_TEMPLATE',
      templateParams: { code: { value: '123456' } },
    };
    vi.mocked(requestClient.post).mockResolvedValue(true);

    await expect(sendTestSms(payload)).resolves.toBe(true);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/sms-channel/test-sms',
      payload,
    );
  });
});

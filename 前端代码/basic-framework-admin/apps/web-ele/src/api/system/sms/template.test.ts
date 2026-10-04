/**
 * 短信模板接口（api/system/sms/template）的地址、方法与参数契约回归。
 *
 * 短信模板页提供分页查询、详情、增删改与按模板发送：地址或方法写错会把模板写到
 * 其它资源，删除编号没拼进查询串会删掉错误的模板，发送短信的接收号码或模板编码
 * 若被改写会把短信发给错误的人并产生真实费用。用例只替换网络收发边界，
 * 接口自身的地址拼装与参数透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createSmsTemplate,
  deleteSmsTemplate,
  getSmsTemplate,
  getSmsTemplatePage,
  sendSms,
  updateSmsTemplate,
} from './template';

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

/** 构造字段完整的短信模板记录，作为各用例的合法基线。 */
function validTemplate() {
  return {
    apiTemplateId: 'DEMO_TEMPLATE',
    channelCode: 'DEMO',
    channelId: 3,
    code: 'DEMO_CODE',
    content: '您的验证码是 {code}',
    id: 7,
    name: '演示模板',
    params: ['code'],
    remark: '演示用模板',
    status: 0,
    type: 1,
  };
}

describe('短信模板查询', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的模板范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validTemplate()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getSmsTemplatePage({ pageNo: 2, pageSize: 10 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/sms-template/page',
      { params: { pageNo: 2, pageSize: 10 } },
    );
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会展示另一个模板的内容与渠道。 */ async () => {
    const detail = validTemplate();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getSmsTemplate(7)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/sms-template/get?id=7',
    );
  });
});

describe('短信模板维护', /** 增删改的地址与方法决定模板配置的落库目标。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增模板使用 POST 提交完整请求体', /** 新增必须用 POST 并原样提交表单数据，内容漏传会让模板发出错误文案。 */ async () => {
    const payload = validTemplate();
    vi.mocked(requestClient.post).mockResolvedValue(7);

    await expect(createSmsTemplate(payload)).resolves.toBe(7);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/sms-template/create',
      payload,
    );
  });

  it('修改模板使用 PUT 提交完整请求体', /** 修改与新增共用路径时必须靠方法区分，误用 POST 会创建重复模板。 */ async () => {
    const payload = validTemplate();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateSmsTemplate(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/sms-template/update',
      payload,
    );
  });

  it('按编号删除模板', /** 编号必须进入查询串，删错模板会让在用业务发不出短信。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteSmsTemplate(7)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/sms-template/delete?id=7',
    );
  });
});

describe('短信模板发送', /** 模板短信会真实计费，接收号码与模板参数不能被改写。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('按模板发送原样提交号码、模板编码与参数', /** 号码或模板编码被改写会把短信发给错误的人并产生费用。 */ async () => {
    const payload = {
      mobile: '13800000000',
      templateCode: 'DEMO_CODE',
      templateParams: { code: { value: '123456' } },
    };
    vi.mocked(requestClient.post).mockResolvedValue(true);

    await expect(sendSms(payload)).resolves.toBe(true);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/sms-template/send-sms',
      payload,
    );
  });

  it('发送失败时把错误原样抛给调用方', /** 失败必须冒泡，页面才能提示用户而不是静默认为已发送。 */ async () => {
    vi.mocked(requestClient.post).mockRejectedValue(new Error('渠道未启用'));

    await expect(
      sendSms({
        mobile: '13800000000',
        templateCode: 'DEMO_CODE',
        templateParams: {},
      }),
    ).rejects.toThrow('渠道未启用');
  });
});

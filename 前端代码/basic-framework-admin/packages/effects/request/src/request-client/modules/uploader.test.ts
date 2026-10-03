/** 真实客户端验证 multipart 编码，拒绝对象字段的隐式字符串化。 */
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RequestClient } from '../request-client';

let client: RequestClient;
let transport: MockAdapter;
beforeEach(
  /** 为每例创建隔离的传输边界。 */ () => {
    client = new RequestClient();
    transport = new MockAdapter(client.instance);
  },
);
afterEach(
  /** 恢复实例适配器。 */ () => {
    transport.restore();
  },
);

describe('文件上传表单边界', /** 检查可编码值、请求头及失败传播。 */ () => {
  it('上传文件、索引数组和基本值，忽略未提供的字段', /** 在真实传输处检查 FormData，不模拟客户端方法。 */ async () => {
    const data = {
      file: new File(['content'], 'test.txt'),
      directory: 'files',
      tags: ['first', undefined, 'last'],
      count: 2,
      enabled: false,
      empty: null,
    };
    transport.onPost('/upload').reply(200, 'uploaded');
    await expect(
      client.upload('/upload', data, { headers: { 'X-Test': 'custom' } }),
    ).resolves.toMatchObject({ data: 'uploaded' });
    const config = transport.history.post[0];
    expect(config?.headers?.['X-Test']).toBe('custom');
    const form: unknown = config?.data;
    if (!(form instanceof FormData)) throw new TypeError('缺少 multipart 表单');
    expect(form.get('file')).toBeInstanceOf(Blob);
    expect(form.get('directory')).toBe('files');
    expect(form.get('tags[0]')).toBe('first');
    expect(form.has('tags[1]')).toBe(false);
    expect(form.get('tags[2]')).toBe('last');
    expect(form.get('count')).toBe('2');
    expect(form.get('enabled')).toBe('false');
    expect(form.has('empty')).toBe(false);
  });
  it.each([{}, Number.POSITIVE_INFINITY, [['nested']]])(
    '不支持的字段在发送前拒绝：%s',
    /** 防止对象或非有限数字被静默编码为错误文本。 */ async (extra) => {
      const data = { file: new Blob(['data']), extra };
      await expect(client.upload('/upload', data)).rejects.toThrow(
        '上传字段 extra',
      );
      expect(transport.history.post).toHaveLength(0);
    },
  );
  it('传输失败继续拒绝原始异常', /** 错误不能作为上传成功结果返回。 */ async () => {
    transport.onPost('/upload').networkError();
    await expect(
      client.upload('/upload', { file: new Blob() }),
    ).rejects.toMatchObject({ message: 'Network Error' });
  });
});

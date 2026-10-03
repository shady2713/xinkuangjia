/** 通过真实 Axios 实例验证请求方法、响应转换及传输失败契约。 */
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultResponseInterceptor } from './preset-interceptors';
import { RequestClient } from './request-client';
import { requireResponse } from './response';

let client: RequestClient;
let transport: MockAdapter;
beforeEach(
  /** 每例拥有真实客户端及独立传输边界。 */ () => {
    client = new RequestClient();
    transport = new MockAdapter(client.instance);
  },
);
afterEach(
  /** 恢复实例传输，不影响后续请求。 */ () => {
    transport.restore();
  },
);

describe('requestClient 实际契约', /** 在公开接口上验证正常、失败和变换后的响应。 */ () => {
  it('默认 GET 保留完整响应', /** 默认不能把 Axios 外壳声明成业务对象。 */ async () => {
    transport.onGet('/resource').reply(200, { value: 'ok' });
    expect(requireResponse(await client.get('/resource')).data).toEqual({
      value: 'ok',
    });
  });
  it.each(['POST', 'PUT'])(
    '%s 保留请求体',
    /** JSON 序列化由实际 Axios 执行。
     * @param method 待验证的 POST 或 PUT 方法。
     */ async (method) => {
      transport.onAny('/resource').reply(200, { value: 'saved' });
      const data = { field: 'value' };
      const result =
        method === 'POST'
          ? await client.post('/resource', data)
          : await client.put('/resource', data);
      expect(requireResponse(result).data).toEqual({ value: 'saved' });
      expect(
        transport.history[method === 'POST' ? 'post' : 'put'][0]?.data,
      ).toBe(JSON.stringify(data));
    },
  );
  it('dELETE 使用真实删除方法', /** 验证公开方法到传输配置的映射。 */ async () => {
    transport.onDelete('/resource').reply(200, true);
    expect(requireResponse(await client.delete('/resource')).data).toBe(true);
  });
  it('网络和超时失败保持可识别的传输异常', /** 没有业务体时不丢失错误码。 */ async () => {
    transport.onGet('/network').networkError();
    transport.onGet('/timeout').timeout();
    await expect(client.get('/network')).rejects.toMatchObject({
      isAxiosError: true,
      message: 'Network Error',
    });
    await expect(client.get('/timeout')).rejects.toMatchObject({
      isAxiosError: true,
      code: 'ECONNABORTED',
    });
  });
  it('标准业务数据可被后续转换，但不会伪装成 HTTP 外壳', /** 响应处理器应接收前一处理器的真实结果。 */ async () => {
    client.addResponseInterceptor(
      defaultResponseInterceptor({
        codeField: 'code',
        dataField: 'data',
        successCode: 0,
      }),
    );
    client.addResponseInterceptor({
      /** 明确收窄解包结果后再操作。
       * @param value 前一处理器返回的业务值。
       * @returns 文本转换结果。
       * @throws {TypeError} 上游没有返回约定的字符串。
       */ fulfilled(value) {
        if (typeof value !== 'string') throw new TypeError('期待字符串');
        return value.toUpperCase();
      },
    });
    transport.onGet('/value').reply(200, { code: 0, data: 'allowed' });
    await expect(
      client.get('/value', { responseReturn: 'data' }),
    ).resolves.toBe('ALLOWED');
  });
  it('畸形业务外壳拒绝解包，空 HTTP 失败保留异常', /** 不把数组或缺失字段作为成功数据。 */ async () => {
    client.addResponseInterceptor(
      defaultResponseInterceptor({
        codeField: 'code',
        dataField: 'data',
        successCode: 0,
      }),
    );
    transport.onGet('/bad').reply(200, []);
    transport.onGet('/http').reply(500);
    await expect(
      client.get('/bad', { responseReturn: 'data' }),
    ).rejects.toMatchObject({ status: 200 });
    await expect(client.get('/http')).rejects.toMatchObject({
      message: 'Request failed with status code 500',
    });
  });
  it('数组查询参数保留选定编码', /** 检查传输配置中实际使用的序列化器。 */ async () => {
    transport.onGet('/params').reply(200, true);
    await client.get('/params', {
      params: { ids: [1, 2] },
      paramsSerializer: 'repeat',
    });
    const serializer = transport.history.get[0]?.paramsSerializer;
    if (
      !serializer ||
      typeof serializer === 'function' ||
      !serializer.serialize
    )
      throw new TypeError('缺少参数编码器');
    expect(serializer.serialize({ ids: [1, 2] })).toBe('ids=1&ids=2');
  });
});

/** 使用真实客户端验证下载返回 Blob 的契约与错误类型拒绝。 */
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RequestClient } from '../request-client';

let client: RequestClient;
let transport: MockAdapter;
beforeEach(
  /** 每例建立真实客户端及网络替身。 */ () => {
    client = new RequestClient();
    transport = new MockAdapter(client.instance);
  },
);
afterEach(
  /** 恢复真实传输设置。 */ () => {
    transport.restore();
  },
);

describe('文件下载响应边界', /** 文件保存工具只能收到已验证 Blob。 */ () => {
  it('未安装业务拦截器时也返回 Blob', /** 防止默认响应外壳泄漏到文件保存 API。 */ async () => {
    const blob = new Blob(['file']);
    transport.onGet('/file').reply(200, blob);
    await expect(client.download('/file')).resolves.toBe(blob);
  });
  it('raw 模式保留 Blob、状态及响应头', /** 调用方明确选择 raw 后才能读取元信息。 */ async () => {
    const blob = new Blob(['file']);
    transport
      .onGet('/file')
      .reply(200, blob, { 'Content-Disposition': 'attachment' });
    const result = await client.download('/file', { responseReturn: 'raw' });
    expect(result.data).toBe(blob);
    expect(result.status).toBe(200);
    expect(result.headers['Content-Disposition']).toBe('attachment');
  });
  it('pOST 下载保留查询、请求体和自定义请求头', /** 所有方法直接走真实 request，不能依赖伪客户端方法存在检查。 */ async () => {
    transport.onPost('/file').reply(200, new Blob());
    await client.download('/file', {
      method: 'POST',
      data: { id: 1 },
      headers: { 'X-Test': 'kept' },
    });
    expect(transport.history.post[0]?.data).toBe('{"id":1}');
    expect(transport.history.post[0]?.headers?.['X-Test']).toBe('kept');
  });
  it('成功 HTTP 中的错误 JSON 不能当文件保存', /** 类型收窄必须在返回 Blob 前执行。 */ async () => {
    transport.onGet('/file').reply(200, { code: 403, msg: 'forbidden' });
    await expect(client.download('/file')).rejects.toThrow('下载响应不是 Blob');
  });
  it('传输失败保留原错误', /** 下载失败不产生空文件。 */ async () => {
    transport.onGet('/file').networkError();
    await expect(client.download('/file')).rejects.toMatchObject({
      message: 'Network Error',
    });
  });
  it('真实 Blob 模式中的业务失败 JSON 也不能保存为文件', /** Axios 的 blob 模式不会将后端错误 JSON 自动解析成对象。 */ async () => {
    const failure = new Blob(['{"code":403,"msg":"forbidden"}'], {
      type: 'application/json',
    });
    transport
      .onGet('/file')
      .reply(200, failure, { 'Content-Type': 'application/json' });
    await expect(client.download('/file')).rejects.toThrow('forbidden');
  });
  it('正常 JSON 文件仍可下载', /** 只有标准业务失败外壳属于错误，普通文件内容不应被误拒绝。 */ async () => {
    const file = new Blob(['{"items":[1]}'], { type: 'application/json' });
    transport
      .onGet('/file')
      .reply(200, file, { 'Content-Type': 'application/json' });
    await expect(client.download('/file')).resolves.toBe(file);
  });
});

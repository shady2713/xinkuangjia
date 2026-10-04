/** 使用真实客户端验证下载返回 Blob 的契约与错误类型拒绝。 */
import type { RequestResponse } from '../types';

import { AxiosHeaders } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RequestClient } from '../request-client';
import { FileDownloader } from './downloader';

/** 构造完整传输响应外壳，供无法经真实适配器产生的响应头形态使用。
 * @param headers 响应头，可为普通对象而非 AxiosHeaders。
 * @returns 满足下载模块外壳校验的响应。
 */
function responseWith(headers: unknown): RequestResponse<Blob> {
  return {
    config: { headers: new AxiosHeaders() } as never,
    data: new Blob(['{"code":403,"msg":"forbidden"}'], {
      type: 'application/octet-stream',
    }),
    headers,
    status: 200,
    statusText: 'OK',
  } as unknown as RequestResponse<Blob>;
}

/** 用固定响应替代网络，专门覆盖真实适配器不会产生的响应头形态。
 * @param response 下载模块将收到的完整响应。
 * @returns 只实现 request 入口的客户端替身。
 */
function clientReturning(response: RequestResponse<Blob>) {
  return {
    /** 返回本例安排的响应，不做任何头规范化。 */
    request: async () => response,
  } as unknown as RequestClient;
}

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
  it('响应头不是 AxiosHeaders 时回退读取普通对象字段', /** 一些适配器只给出普通对象响应头，不能因此跳过业务失败识别。 */ async () => {
    const failure = new Blob(['{"code":403,"msg":"forbidden"}'], {
      type: 'application/octet-stream',
    });
    transport.onGet('/file').reply(
      200,
      failure,
      /** 以小写字段名的普通对象提供响应头，模拟非标准适配器输出。 */ {
        'content-type': 'application/json',
      },
    );
    await expect(client.download('/file')).rejects.toThrow('forbidden');
  });
  it('声明为 JSON 但内容无法解析时按普通文件放行', /** 导出文件可能是伪装成 JSON 的文本，解析失败不能当成业务错误。 */ async () => {
    const file = new Blob(['not-json-content'], { type: 'application/json' });
    transport
      .onGet('/file')
      .reply(200, file, { 'Content-Type': 'application/json' });
    await expect(client.download('/file')).resolves.toBe(file);
  });
  it('业务失败缺少字符串文案时使用统一兜底提示', /** 后端未返回 msg 时也要给出确定错误，不能显示 undefined。 */ async () => {
    const failure = new Blob(['{"code":500,"msg":{"detail":"boom"}}'], {
      type: 'application/json',
    });
    transport
      .onGet('/file')
      .reply(200, failure, { 'Content-Type': 'application/json' });
    await expect(client.download('/file')).rejects.toThrow('下载请求失败');
  });
  it('响应头为普通对象时仍能识别 JSON 业务失败', /** 非 Axios 适配器可能只给出普通响应头，此时不能跳过业务失败识别。 */ async () => {
    const downloader = new FileDownloader(
      clientReturning(
        responseWith({
          'Content-Type': 'application/json',
        }),
      ),
    );

    await expect(downloader.download('/file')).rejects.toThrow('forbidden');
  });
  it('普通对象响应头只有小写字段名时同样识别失败', /** HTTP 头大小写不敏感，读取端必须兼容小写键。 */ async () => {
    const downloader = new FileDownloader(
      clientReturning(
        responseWith({
          'content-type': 'application/json',
        }),
      ),
    );

    await expect(downloader.download('/file')).rejects.toThrow('forbidden');
  });
  it('普通对象响应头声明非 JSON 时按文件放行', /** 响应头类型判断同样适用于普通对象，不能一律当成 JSON。 */ async () => {
    const downloader = new FileDownloader(
      clientReturning(responseWith({ 'Content-Type': 'text/plain' })),
    );

    await expect(downloader.download('/file')).resolves.toBeInstanceOf(Blob);
  });
});

/** SSE 复用公开请求入口及 Fetch 适配器，不读取 Axios 内部拦截器。 */
import type { RequestClient } from '../request-client';
import type { SseRequestOptions } from '../types';

import { requireResponse } from '../response';

/** 按 UTF-8 传输块交付流内容，并在错误、取消和身份切换时释放读取器。 */
class SSE {
  private client: RequestClient;

  /** 使用所属客户端的身份、请求头和响应处理链。
   * @param client 负责统一发送及身份管理的客户端。
   */
  constructor(client: RequestClient) {
    this.client = client;
  }

  /** 以 POST 方法建立文本流。
   * @param url 相对于客户端根地址的流接口。
   * @param data 由 Axios 根据 Content-Type 序列化的请求体。
   * @param requestOptions Fetch 选项及分块回调。
   * @returns 流消费结束后的完成通知。
   */
  public async postSSE(
    url: string,
    data?: unknown,
    requestOptions?: SseRequestOptions,
  ) {
    return this.requestSSE(url, data, { ...requestOptions, method: 'POST' });
  }

  /** 通过公开 Fetch 适配器建立流，整个消费期间维持发起身份。
   * @param url 相对于客户端根地址或明确指定的流接口。
   * @param data 请求数据；显式 body 优先于该值。
   * @param requestOptions 请求参数、分块通知及正常结束通知。
   * @returns 流正常结束时完成，取消或失败时拒绝。
   * @throws {Error} 传输失败、非字节流、身份变化或消费回调失败。
   */
  public async requestSSE(
    url: string,
    data?: unknown,
    requestOptions: SseRequestOptions = {},
  ) {
    const { body, headers, method, onMessage, onEnd, signal, ...fetchOptions } =
      requestOptions;
    const requestHeaders: Record<string, string> = {};
    new Headers(headers).forEach(
      /** 显式转成 Axios 接受的字符串头，不断言 Headers 为普通对象。 */ (
        value,
        key,
      ) => {
        requestHeaders[key] = value;
      },
    );
    requestHeaders.Accept ??= requestHeaders.accept ?? 'text/event-stream';
    const response = requireResponse(
      await this.client.request<unknown>(url, {
        adapter: 'fetch',
        data: body ?? data,
        fetchOptions,
        headers: requestHeaders,
        method: method ?? 'GET',
        responseReturn: 'raw',
        responseType: 'stream',
        signal: signal ?? undefined,
        timeout: 0,
      }),
    );
    if (!(response.data instanceof ReadableStream))
      throw new TypeError('响应不是可读取的字节流');
    const reader = response.data.getReader();
    const decoder = new TextDecoder();
    let completed = false;
    try {
      this.client.assertRequestSession(response.config.sessionEpoch);
      while (true) {
        const { done, value } = await reader.read();
        this.client.assertRequestSession(response.config.sessionEpoch);
        if (done) {
          const tail = decoder.decode();
          if (tail) onMessage?.(tail);
          this.client.assertRequestSession(response.config.sessionEpoch);
          completed = true;
          onEnd?.();
          return;
        }
        if (!(value instanceof Uint8Array))
          throw new TypeError('流数据必须是 UTF-8 字节');
        const content = decoder.decode(value, { stream: true });
        if (content) onMessage?.(content);
      }
    } finally {
      if (!completed)
        await reader
          .cancel()
          .catch(/** 清理失败不得覆盖身份取消或原消费异常。 */ () => undefined);
      reader.releaseLock();
    }
  }
}

export { SSE };

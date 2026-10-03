// @vitest-environment node
/** 使用 Node 的标准 Fetch/Streams 实现验证真实适配器；Happy DOM 的 Response 尚不支持字节流。 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestClient } from '../request-client';

/** 用字节块建立可正常关闭的真实响应。 */
function streamResponse(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      /** 同步入队测试字节，由真实读取器分块消费。
       * @param controller 本例真实字节流控制器。
       */ start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}

/** 创建测试可显式安排完成顺序的信号。 */
function deferred<T>() {
  let resolve!: /** 释放等待者并交付本例结果。 */ (value: T) => void;
  const promise = new Promise<T>(
    /** 保存外部完成控制器。 */ (accept) => {
      resolve = accept;
    },
  );
  return { promise, resolve };
}

afterEach(
  /** 每例恢复原生 fetch，不向其他网络测试泄漏替身。 */ () => {
    vi.unstubAllGlobals();
  },
);

describe('sSE 公开请求链', /** 测试真实字节流、请求配置及身份隔离。 */ () => {
  it('复用请求拦截器、POST 序列化并正确拼接根路径', /** 在真实 Fetch Request 上核实参数，不依赖 Axios 私有字段。 */ async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(streamResponse([new TextEncoder().encode('ok')]));
    vi.stubGlobal('fetch', fetchMock);
    const client = new RequestClient({ baseURL: 'https://example.test/api' });
    client.addRequestInterceptor({
      /** 通过公开入口附加业务头。
       * @param config 真实 Axios 发送配置。
       * @returns 已附加测试头的原请求配置。
       */ fulfilled(config) {
        config.headers.set('X-Test', 'intercepted');
        return config;
      },
    });
    await client.postSSE('/events', { task: 'test' });
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new TypeError('缺少 Fetch 请求');
    expect(request.url).toBe('https://example.test/api/events');
    expect(request.method).toBe('POST');
    expect(request.headers.get('X-Test')).toBe('intercepted');
    expect(request.headers.get('Accept')).toBe('text/event-stream');
    expect(await request.text()).toBe('{"task":"test"}');
  });

  it('保留跨块 UTF-8 字符并只在正常完成时调用 onEnd', /** 多字节字符跨块时不能丢字或重复发出结束通知。 */ async () => {
    const bytes = new TextEncoder().encode('你好');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(streamResponse([bytes.slice(0, 2), bytes.slice(2)])),
    );
    const messages: string[] = [];
    const onEnd = vi.fn();
    await new RequestClient({ baseURL: 'https://example.test' }).requestSSE(
      '/events',
      undefined,
      {
        /** 拼接实际到达的文本片段。 */ onMessage: (message) => {
          messages.push(message);
        },
        onEnd,
      },
    );
    expect(messages.join('')).toBe('你好');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('hTTP 失败保留传输异常，空流拒绝消费', /** 流或空结果不能伪装成有效业务响应。 */ async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('failed', { status: 500 }))
      .mockResolvedValueOnce(new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    const client = new RequestClient({ baseURL: 'https://example.test' });
    await expect(client.requestSSE('/failed')).rejects.toMatchObject({
      message: 'Request failed with status code 500',
    });
    await expect(client.requestSSE('/empty')).rejects.toThrow('字节流');
  });

  it('收到下一块前身份改变时取消读取，不交付旧内容或结束事件', /** 控制流写入顺序，证明长连接不是只在建立时检查身份。 */ async () => {
    let epoch = 1;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const opened = deferred<undefined>();
    const canceled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      /** 保存当前流的可控写入端。
       * @param value 稍后由用例释放内容的字节流控制器。
       */ start(value) {
        controller = value;
        value.enqueue(new TextEncoder().encode('initial-A'));
      },
      /** 记录实际释放了旧身份流。 */ cancel: canceled,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    );
    const onMessage = vi.fn(
      /** 首块实际交付后才允许测试切换身份。 */ () => {
        opened.resolve(undefined);
      },
    );
    const onEnd = vi.fn();
    const client = new RequestClient({
      baseURL: 'https://example.test',
      /** 返回当前测试身份。 */ getSessionEpoch: () => epoch,
    });
    const request = client.requestSSE('/events', undefined, {
      onMessage,
      onEnd,
    });
    const rejection = expect(request).rejects.toMatchObject({
      code: 'ERR_CANCELED',
    });
    await opened.promise;
    epoch = 2;
    if (!controller) throw new TypeError('缺少流控制器');
    controller.enqueue(new TextEncoder().encode('old-private-data'));
    await rejection;
    expect(onMessage).toHaveBeenCalledExactlyOnceWith('initial-A');
    expect(onEnd).not.toHaveBeenCalled();
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('响应处理链拒绝建立后的流时仍释放资源', /** 模拟应用在晚到响应上拒绝身份，验证读取器建立之前也会清理。 */ async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    );
    const client = new RequestClient({ baseURL: 'https://example.test' });
    client.addResponseInterceptor({
      /** 模拟应用的响应身份检查失败。
       * @throws {Error} 用例安排响应链拒绝尚未交付的流。
       */ fulfilled() {
        throw new Error('session changed');
      },
    });
    await expect(client.requestSSE('/events')).rejects.toThrow(
      'session changed',
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('消费回调抛错时取消底层流并释放读取锁', /** 用户回调失败也必须清理网络资源。 */ async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      /** 保持流开放，以便观察失败清理。
       * @param controller 本例真实字节流控制器。
       */ start(controller) {
        controller.enqueue(new TextEncoder().encode('data'));
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    );
    const client = new RequestClient({ baseURL: 'https://example.test' });
    await expect(
      client.requestSSE('/events', undefined, {
        /** 模拟下游解析失败，测试必须保留原错误。
         * @throws {Error} 用例安排消费者必定失败以检查清理行为。
         */ onMessage() {
          throw new Error('consumer failed');
        },
      }),
    ).rejects.toThrow('consumer failed');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
});

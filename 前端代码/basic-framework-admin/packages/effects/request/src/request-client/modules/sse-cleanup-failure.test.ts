// @vitest-environment node
/**
 * SSE 流清理失败（request-client/modules/sse）真实行为回归。
 *
 * 长连接在消费失败或身份变更时必须释放读取器：读取器取消走的是真实底层流的 cancel 算法，
 * 而网络栈在连接已断开时取消本身也会失败。若取消失败被直接抛出，服务端原始异常或
 * 「登录会话已变更」这类取消原因就会被清理错误覆盖，调用方无法据此判断该重试还是该跳转登录；
 * 同时读取锁必须仍然释放，否则同一流无法再被安全丢弃。用例在真实 Node 字节流上安排
 * 「取消被拒」的底层实现，断言原异常类型与文案不变、取消确实被尝试、读取锁已释放。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestClient } from '../request-client';

afterEach(
  /** 每例恢复原生 fetch，不向其他网络用例泄漏替身。 */ () => {
    vi.unstubAllGlobals();
  },
);

/**
 * 建立底层取消必然失败的真实字节流。
 * @param chunks 建流时同步入队的字节块，供真实读取器消费。
 * @returns 真实未锁定字节流与底层取消调用记录。
 */
function streamWithFailingCancel(chunks: Uint8Array[]) {
  const cancelAttempt = vi.fn(
    /** 模拟网络栈取消失败：清理异常不得覆盖原异常。 */ () =>
      Promise.reject(new Error('DUMMY-底层取消失败')),
  );
  const stream = new ReadableStream<Uint8Array>({
    /** 同步入队字节，让消费链路确实读过数据后才失败。
     * @param controller 本例真实字节流控制器。
     */ start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
    },
    cancel: cancelAttempt,
  });
  return { cancelAttempt, stream };
}

describe('sSE 清理失败不覆盖原异常', /** 取消失败被抛出会让调用方丢失真实的失败原因。 */ () => {
  it('消费回调抛错且读取器取消失败时保留消费异常', /** 覆盖清理错误会让上游把业务解析错误误判成网络清理错误。 */ async () => {
    const { cancelAttempt, stream } = streamWithFailingCancel([
      new TextEncoder().encode('data'),
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    );
    const onMessage = vi.fn(
      /** 模拟下游按事件分帧时失败。
       * @throws {Error} 用例安排消费者必定失败以检查清理行为。
       */ () => {
        throw new Error('DUMMY-消费失败');
      },
    );
    const onEnd = vi.fn();

    await expect(
      new RequestClient({ baseURL: 'https://example.test' }).requestSSE(
        '/events',
        undefined,
        { onMessage, onEnd },
      ),
    ).rejects.toThrow('DUMMY-消费失败');

    // 底层取消确实被尝试过一次，且读取锁已经释放，流可以被重新处理。
    expect(cancelAttempt).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    // 未正常结束就不能发出结束通知。
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('身份变更取消且读取器取消失败时保留取消原因', /** 清理错误覆盖取消原因会让调用方无法识别登录切换。 */ async () => {
    const { cancelAttempt, stream } = streamWithFailingCancel([
      new TextEncoder().encode('old-private-data'),
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)),
    );
    let epoch = 1;
    const client = new RequestClient({
      baseURL: 'https://example.test',
      /** 返回当前测试身份，供消费期同步核对。 */ getSessionEpoch: () => epoch,
    });

    const request = client.requestSSE('/events');
    // 首次读取之前切换身份：请求已按旧身份建立，消费必须立即中止。
    epoch = 2;

    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(cancelAttempt).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });
});

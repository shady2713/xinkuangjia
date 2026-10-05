// @vitest-environment node
/**
 * 请求客户端未交付字节流的清理（request-client/request-client）真实行为回归。
 *
 * 当响应处理链拒绝一个已经到达、但尚未交付给业务代码的响应时，客户端必须主动取消其中的
 * 字节流，否则下载、导出类接口会一直占着连接。取消本身可能失败（连接已被对端关闭），
 * 此时清理错误绝不能覆盖真正的请求异常，否则调用方拿到的是无意义的清理失败，既无法定位
 * 业务问题也无法决定是否重试；已经交付给其他消费方的流（locked）则必须原样放过，不能被
 * 二次取消。用例走真实 Axios 传输与真实 ReadableStream 字节流，只把传输边界换成直接交付
 * 未锁定流的适配器。
 */
import { describe, expect, it, vi } from 'vitest';

import { RequestClient } from './request-client';

/**
 * 建立底层取消必然失败的真实未锁定字节流。
 * @returns 真实字节流与底层取消调用记录。
 */
function streamWithFailingCancel() {
  const cancelAttempt = vi.fn(
    /** 模拟传输层取消失败：清理异常不得覆盖原异常。 */ () =>
      Promise.reject(new Error('DUMMY-流取消失败')),
  );
  const stream = new ReadableStream<Uint8Array>({
    cancel: cancelAttempt,
  });
  return { cancelAttempt, stream };
}

/**
 * 建立交付指定响应的请求客户端。
 * @param data 适配器要交付的响应体。
 * @returns 使用真实 Axios 传输链、只替换适配器的客户端。
 */
function clientDelivering(data: unknown) {
  return new RequestClient({
    /** 直接交付指定响应体，验证处理链拒绝后的清理行为。 */
    adapter: async (config) => ({
      config,
      data,
      headers: {},
      status: 200,
      statusText: 'OK',
    }),
  });
}

describe('未交付字节流的清理', /** 处理链拒绝已到达的流时必须释放连接且不掩盖原异常。 */ () => {
  it('取消失败时保留处理链的原始异常', /** 清理错误覆盖原异常会让调用方拿到与业务无关的失败原因。 */ async () => {
    const { cancelAttempt, stream } = streamWithFailingCancel();
    const client = clientDelivering(stream);
    client.addResponseInterceptor({
      /** 模拟业务侧在交付前拒绝该响应。
       * @throws {Error} 用例安排处理链必定失败以检查清理行为。
       */ fulfilled() {
        throw new Error('DUMMY-处理链拒绝');
      },
    });

    await expect(client.get('/stream')).rejects.toThrow('DUMMY-处理链拒绝');

    // 流未被读取过，客户端必须尝试取消一次，并保持流处于可再处理状态。
    expect(cancelAttempt).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
  });

  it('已被消费方锁定的流不再二次取消', /** 二次取消会打断正在读取该流的业务代码，必须按 locked 放过。 */ async () => {
    const { cancelAttempt, stream } = streamWithFailingCancel();
    const reader = stream.getReader();
    const client = clientDelivering(stream);
    client.addResponseInterceptor({
      /** 模拟业务侧在交付前拒绝该响应。
       * @throws {Error} 用例安排处理链必定失败以检查清理行为。
       */ fulfilled() {
        throw new Error('DUMMY-处理链拒绝');
      },
    });

    await expect(client.get('/stream')).rejects.toThrow('DUMMY-处理链拒绝');

    expect(cancelAttempt).not.toHaveBeenCalled();
    expect(stream.locked).toBe(true);
    reader.releaseLock();
  });
});

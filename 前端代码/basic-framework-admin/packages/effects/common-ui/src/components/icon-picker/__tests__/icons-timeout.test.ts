/**
 * Iconify 图标集拉取超时中止（icon-picker/icons 的 10 秒兜底）的真实行为回归。
 *
 * 图标选择器打开后会请求 Iconify 公共接口，接口不可达时必须由内置超时主动中止请求，
 * 并沿既有失败兜底返回空列表；缺少这次中止，选择器会永久停在加载中，用户既选不到图标
 * 也拿不到失败反馈，同时在途请求永远不会释放。Iconify 属于外部网络边界，用例用永不返回
 * 的请求替身模拟「接口无响应」并按真实 fetch 语义在中止时拒绝，定时窗口由假定时器推进，
 * 缓存、在途去重与失败兜底全部走真实实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchIconsData } from '../icons';

describe('fetchIconsData 超时中止', /** 外部接口无响应时必须靠内置超时收敛为失败兜底，而不是无限等待。 */ () => {
  beforeEach(
    /** 超时由定时器驱动，用例切换到假定时器以便推进 10 秒窗口。 */ () => {
      vi.useFakeTimers();
    },
  );

  afterEach(
    /** 恢复真实定时器与全局替身，避免影响其它用例。 */ () => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  );

  it('10 秒无响应时中止请求并返回空列表', /** 不中止会让选择器永久转圈，不兜底会让调用方收到未处理的拒绝。 */ async () => {
    /** 记录真实请求使用的中止信号，用于核对内置超时确实触发了中止。 */
    const abortSignals: AbortSignal[] = [];
    // Iconify 是外部网络边界：这里用永不返回的请求代替真实接口，
    // 并在信号中止时按真实 fetch 的语义以 AbortError 拒绝。
    vi.stubGlobal(
      'fetch',
      vi.fn(
        /** 永不返回的请求替身：记录中止信号，并在中止时按真实语义拒绝。 */ (
          _url: string,
          init?: { signal?: AbortSignal },
        ) => {
          const signal = init?.signal;
          if (!signal) {
            throw new TypeError('图标集请求缺少中止信号');
          }
          abortSignals.push(signal);
          return new Promise(
            /** 保存本次请求的拒绝入口，等待中止信号触发。 */ (
              _resolve,
              reject,
            ) => {
              signal.addEventListener(
                'abort',
                /** 中止时按真实 fetch 语义拒绝本次请求。 */ () => {
                  reject(
                    new DOMException(
                      'The operation was aborted.',
                      'AbortError',
                    ),
                  );
                },
              );
            },
          );
        },
      ),
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默预期内的失败日志，避免污染测试输出。 */ () => {},
      );

    const pending = fetchIconsData('DUMMY-timeout-icons');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(abortSignals).toHaveLength(1);
    expect(abortSignals[0]?.aborted).toBe(true);
    // 中止后仍走真实的 catch 兜底：告警并交出空列表，而不是抛出。
    await expect(pending).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to fetch icons for prefix DUMMY-timeout-icons:',
      expect.any(DOMException),
    );
  });
});

/** 验证应用真实请求链在会话切换后拒绝成功响应、刷新写入与延迟发送。 */
import type { AxiosResponse, InternalAxiosRequestConfig } from '@vben/request';

import { useAccessStore } from '@vben/stores';

import {
  createPinia,
  disposePinia,
  getActivePinia,
  setActivePinia,
} from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceSession } from '#/utils/auth-session';

import { refreshTokenApi } from './core';
import { requestClient } from './request';

vi.mock(
  '@vben/hooks',
  /** 仅固定接口根地址，不替换请求或状态逻辑。 */ () => ({
    /** 测试的传输由适配器隔离，不连接真实服务。 */ useAppConfig: () => ({
      apiURL: '/api',
    }),
  }),
);
vi.mock(
  '@vben/preferences',
  /** 启用生产刷新分支，语言只影响请求头。 */ () => ({
    preferences: { app: { enableRefreshToken: true, locale: 'zh-CN' } },
  }),
);
vi.mock(
  './core',
  /** 控制外部刷新结果，其他业务请求经过真实客户端。 */ () => ({
    refreshTokenApi: vi.fn(),
  }),
);
vi.mock(
  '#/store',
  /** 记录失效退出副作用，不创建依赖应用启动的认证 Store。 */ () => ({
    /** 返回可观测的退出边界。 */ useAuthStore: () => ({ logout: vi.fn() }),
  }),
);

/** 为传输层构造保留原始请求配置的标准响应。 */
function response(
  config: InternalAxiosRequestConfig,
  data: unknown,
): AxiosResponse {
  return { config, data, headers: {}, status: 200, statusText: 'OK' };
}

/** 创建兼容支持工具链的受控 Promise，显式安排请求完成顺序。 */
function deferred<T>() {
  let resolve!: /** 成功释放本例等待的异步结果。 */ (
    value: PromiseLike<T> | T,
  ) => void;
  let reject!: /** 将受控错误传播给本例等待者。 */ (reason?: unknown) => void;
  const promise = new Promise<T>(
    /** 保存仅由本例持有的完成控制器。 */ (accept, fail) => {
      resolve = accept;
      reject = fail;
    },
  );
  return { promise, reject, resolve };
}

describe('应用请求身份隔离', /** 通过真实拦截器拒绝过期会话操作。 */ () => {
  const originalAdapter = requestClient.instance.defaults.adapter;

  beforeEach(
    /** 每例创建独立身份和 Store，避免凭据相互污染。 */ () => {
      advanceSession();
      setActivePinia(createPinia());
      vi.mocked(refreshTokenApi).mockReset();
      useAccessStore().setAccessToken('test-session-A');
      useAccessStore().setRefreshToken('test-refresh-A');
    },
  );

  afterEach(
    /** 恢复真实客户端的传输边界并释放测试 Store。 */ () => {
      requestClient.instance.defaults.adapter = originalAdapter;
      const pinia = getActivePinia();
      if (pinia) disposePinia(pinia);
    },
  );

  it('异步请求拦截器执行前已换身份时，不发送旧请求', /** 立即切换身份，证明代次在同步 request 入口已捕获。 */ async () => {
    const adapter = vi.fn(
      /** 若请求错误到达传输层则返回可识别结果。 */ async (
        config: InternalAxiosRequestConfig,
      ) => response(config, { code: 0, data: 'unexpected' }),
    );
    requestClient.instance.defaults.adapter = adapter;
    const request = requestClient.get('/private');
    advanceSession();
    useAccessStore().setAccessToken('test-session-B');
    await expect(request).rejects.toMatchObject({
      name: 'SessionChangedError',
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('旧成功响应不能返回给业务调用方', /** 请求发出后换身份，再释放旧响应。 */ async () => {
    const sent = deferred<InternalAxiosRequestConfig>();
    const pending = deferred<AxiosResponse>();
    requestClient.instance.defaults.adapter =
      /** 标记传输已经开始，等待用例控制的响应。 */ (config) => {
        sent.resolve(config);
        return pending.promise;
      };
    const request = requestClient.get('/private');
    const rejected = expect(request).rejects.toMatchObject({
      name: 'SessionChangedError',
    });
    const config = await sent.promise;
    advanceSession();
    useAccessStore().setAccessToken('test-session-B');
    pending.resolve(response(config, { code: 0, data: 'A-private-data' }));
    await rejected;
    expect(useAccessStore().accessToken).toBe('test-session-B');
  });

  it('旧刷新成功不写入新身份令牌或重发旧请求', /** 刷新在旧身份确已发起，再模拟新登录及旧结果返回。 */ async () => {
    const started = deferred<undefined>();
    const refresh = deferred<Awaited<ReturnType<typeof refreshTokenApi>>>();
    vi.mocked(refreshTokenApi).mockImplementation(
      /** 发出刷新后通知用例切换身份。 */ () => {
        started.resolve(undefined);
        return refresh.promise;
      },
    );
    const adapter = vi.fn(
      /** 未授权业务响应触发真实刷新逻辑。 */ async (
        config: InternalAxiosRequestConfig,
      ) => response(config, { code: 401 }),
    );
    requestClient.instance.defaults.adapter = adapter;
    const request = requestClient.get('/private');
    const rejected = expect(request).rejects.toMatchObject({
      name: 'SessionChangedError',
    });
    await started.promise;
    advanceSession();
    useAccessStore().setAccessToken('test-session-B');
    useAccessStore().setRefreshToken('test-refresh-B');
    refresh.resolve({
      accessToken: 'late-A',
      refreshToken: 'late-refresh-A',
      userId: 1,
      expiresTime: 1_900_000_000_000,
    });
    await rejected;
    expect(useAccessStore().accessToken).toBe('test-session-B');
    expect(useAccessStore().refreshToken).toBe('test-refresh-B');
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('当前身份刷新成功会更新轮换令牌并仅重试原请求一次', /** 对比两次传输所用的认证头，验证正常刷新仍可用。 */ async () => {
    vi.mocked(refreshTokenApi).mockResolvedValue({
      accessToken: 'renewed-A',
      refreshToken: 'renewed-refresh-A',
      userId: 1,
      expiresTime: 1_900_000_000_000,
    });
    const authorizations: unknown[] = [];
    requestClient.instance.defaults.adapter =
      /** 首次拒绝、第二次成功，同时记录真实 Authorization。 */ async (
        config,
      ) => {
        authorizations.push(config.headers.Authorization);
        return response(
          config,
          authorizations.length === 1
            ? { code: 401 }
            : { code: 0, data: 'allowed' },
        );
      };
    await expect(requestClient.get('/private')).resolves.toBe('allowed');
    expect(authorizations).toEqual([
      'Bearer test-session-A',
      'Bearer renewed-A',
    ]);
    expect(useAccessStore().refreshToken).toBe('renewed-refresh-A');
    expect(refreshTokenApi).toHaveBeenCalledTimes(1);
  });
});

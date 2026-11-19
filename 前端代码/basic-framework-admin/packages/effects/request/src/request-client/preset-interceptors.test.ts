/**
 * 验证认证响应拦截器在并发 401 刷新令牌成功与失败时的队列行为。
 *
 * @author shady2713
 */
import type { RequestClient } from './request-client';

import { describe, expect, it, vi } from 'vitest';

import {
  authenticateResponseInterceptor,
  errorMessageResponseInterceptor,
} from './preset-interceptors';

/** 字符串可控 Promise 解决回调签名。 */
type DeferredResolve = (value: PromiseLike<string> | string) => void;

/** 可控 Promise 拒绝回调签名。 */
type DeferredReject = (reason?: unknown) => void;

/**
 * 创建延迟可控的字符串 Promise，用于模拟并发请求在刷新期间入队。
 *
 * @returns Promise 本体及其 resolve/reject 控制器
 */
function createDeferred() {
  /** 默认空操作成功回调占位。 */
  function noopResolve(_value: PromiseLike<string> | string) {}
  /** 默认空操作失败回调占位。 */
  function noopReject(_reason?: unknown) {}
  let resolve: DeferredResolve = noopResolve;
  let reject: DeferredReject = noopReject;
  /**
   * 绑定 Promise 控制器回调。
   *
   * @param res 成功回调
   * @param rej 失败回调
   */
  function executor(res: DeferredResolve, rej: DeferredReject) {
    resolve = res;
    reject = rej;
  }
  const promise = new Promise<string>(executor);
  return { promise, reject, resolve };
}

/**
 * 格式化 Bearer 令牌请求头。
 *
 * @param token 原始访问令牌
 * @returns Bearer 授权头字符串
 */
function formatBearerToken(token: string) {
  return `Bearer ${token}`;
}

/** 验证刷新令牌失败时立即拒绝全部排队请求，不发起空令牌重试且只触发一次重新认证。 */
async function rejectsQueuedRequestsWhenRefreshFails() {
  const refreshDeferred = createDeferred();
  const requestSpy = vi.fn();
  const doReAuthenticate = vi.fn().mockResolvedValue(undefined);
  /**
   * 返回可控刷新 Promise。
   *
   * @returns 待决刷新令牌 Promise
   */
  function doRefreshToken() {
    return refreshDeferred.promise;
  }

  const fakeClient = {
    isRefreshing: false,
    refreshTokenQueue: [],
    request: requestSpy,
  } as unknown as RequestClient;

  const interceptor = authenticateResponseInterceptor({
    client: fakeClient,
    doReAuthenticate,
    doRefreshToken,
    enableRefreshToken: true,
    formatToken: formatBearerToken,
  });
  if (!interceptor.rejected) {
    throw new Error('缺少 rejected 拦截器');
  }

  const first401 = {
    config: { headers: {}, url: '/system/user/page' },
    response: { status: 401 },
  };
  const second401 = {
    config: { headers: {}, url: '/system/role/simple-list' },
    response: { status: 401 },
  };

  const firstAttempt = interceptor.rejected(first401);
  const secondAttempt = interceptor.rejected(second401);

  expect(fakeClient.isRefreshing).toBe(true);
  expect(fakeClient.refreshTokenQueue).toHaveLength(1);

  const refreshFailure = new Error('refresh-expired');
  refreshDeferred.reject(refreshFailure);

  await expect(firstAttempt).rejects.toThrow('refresh-expired');
  await expect(secondAttempt).rejects.toThrow('refresh-expired');
  expect(requestSpy).not.toHaveBeenCalled();
  expect(doReAuthenticate).toHaveBeenCalledTimes(1);
  expect(fakeClient.isRefreshing).toBe(false);
}

/** 验证刷新令牌成功时携带新令牌重放当前请求与排队请求。 */
async function replaysQueuedRequestsWhenRefreshSucceeds() {
  const refreshDeferred = createDeferred();
  /**
   * 模拟重放请求返回结果。
   *
   * @param url 请求地址
   * @param config 请求配置
   * @returns 包含地址与请求头的模拟响应
   */
  function mockReplayRequest(url: string, config: Record<string, any>) {
    return Promise.resolve({
      authorization: config.headers?.Authorization,
      url,
    });
  }
  const requestSpy = vi.fn(mockReplayRequest);
  const doReAuthenticate = vi.fn().mockResolvedValue(undefined);
  /**
   * 返回可控刷新 Promise。
   *
   * @returns 待决刷新令牌 Promise
   */
  function doRefreshToken() {
    return refreshDeferred.promise;
  }

  const fakeClient = {
    isRefreshing: false,
    refreshTokenQueue: [],
    request: requestSpy,
  } as unknown as RequestClient;

  const interceptor = authenticateResponseInterceptor({
    client: fakeClient,
    doReAuthenticate,
    doRefreshToken,
    enableRefreshToken: true,
    formatToken: formatBearerToken,
  });
  if (!interceptor.rejected) {
    throw new Error('缺少 rejected 拦截器');
  }

  const firstAttempt = interceptor.rejected({
    config: { headers: {}, url: '/system/user/page' },
    response: { status: 401 },
  });
  const secondAttempt = interceptor.rejected({
    config: { headers: {}, url: '/system/dept/simple-list' },
    response: { status: 401 },
  });

  refreshDeferred.resolve('fresh-access-token');

  await expect(firstAttempt).resolves.toEqual({
    authorization: 'Bearer fresh-access-token',
    url: '/system/user/page',
  });
  await expect(secondAttempt).resolves.toEqual({
    authorization: 'Bearer fresh-access-token',
    url: '/system/dept/simple-list',
  });
  expect(requestSpy).toHaveBeenCalledTimes(2);
  expect(doReAuthenticate).not.toHaveBeenCalled();
}

/** 验证 401 刷新成功后重放请求返回 500 时，仅在内层提示一次错误，外层不再重复弹窗。 */
async function suppressesDuplicateToastWhenReplayedRequestFails() {
  const makeErrorMessage = vi.fn();
  const errorInterceptor = errorMessageResponseInterceptor(makeErrorMessage);
  /**
   * 模拟重放请求命中内层错误拦截器后抛出 500 异常。
   *
   * @returns 经过内层错误拦截器处理的被拒 Promise
   */
  function mockReplayFailure() {
    const replayError = {
      config: { headers: {}, url: '/system/user/page' },
      response: { data: { msg: '服务器开小差了' }, status: 500 },
    };
    return errorInterceptor.rejected?.(replayError);
  }
  const fakeClient = {
    isRefreshing: false,
    refreshTokenQueue: [],
    request: vi.fn(mockReplayFailure),
  } as unknown as RequestClient;
  const authInterceptor = authenticateResponseInterceptor({
    client: fakeClient,
    doReAuthenticate: vi.fn().mockResolvedValue(undefined),
    doRefreshToken: vi.fn().mockResolvedValue('fresh-token'),
    enableRefreshToken: true,
    formatToken: formatBearerToken,
  });
  const first401 = {
    config: { headers: {}, url: '/system/user/page' },
    response: { status: 401 },
  };

  let outerError: unknown;
  try {
    await authInterceptor.rejected?.(first401);
  } catch (error) {
    outerError = error;
  }

  await expect(errorInterceptor.rejected?.(outerError)).rejects.toBe(
    outerError,
  );
  expect(makeErrorMessage).toHaveBeenCalledTimes(1);
}

/** 验证刷新令牌失败并触发重认证时，主请求与排队请求都不会在外层触发重复错误弹窗。 */
async function suppressesRedundantToastsWhenRefreshFails() {
  const refreshDeferred = createDeferred();
  const makeErrorMessage = vi.fn();
  const errorInterceptor = errorMessageResponseInterceptor(makeErrorMessage);
  /**
   * 返回可控刷新 Promise。
   *
   * @returns 待决刷新令牌 Promise
   */
  function doRefreshToken() {
    return refreshDeferred.promise;
  }
  const fakeClient = {
    isRefreshing: false,
    refreshTokenQueue: [],
    request: vi.fn(),
  } as unknown as RequestClient;
  const authInterceptor = authenticateResponseInterceptor({
    client: fakeClient,
    doReAuthenticate: vi.fn().mockResolvedValue(undefined),
    doRefreshToken,
    enableRefreshToken: true,
    formatToken: formatBearerToken,
  });

  const firstAttempt = authInterceptor.rejected?.({
    config: { headers: {}, url: '/system/user/page' },
    response: { status: 401 },
  });
  const secondAttempt = authInterceptor.rejected?.({
    config: { headers: {}, url: '/system/role/page' },
    response: { status: 401 },
  });
  refreshDeferred.reject(new Error('refresh-expired'));

  const [firstErr, secondErr] = await Promise.all([
    firstAttempt?.catch((error: unknown) => error),
    secondAttempt?.catch((error: unknown) => error),
  ]);
  await expect(errorInterceptor.rejected?.(firstErr)).rejects.toBe(firstErr);
  await expect(errorInterceptor.rejected?.(secondErr)).rejects.toBe(secondErr);
  expect(makeErrorMessage).not.toHaveBeenCalled();
}

/** authenticateResponseInterceptor 测试套件。 */
function authenticateInterceptorSuite() {
  it(
    '刷新令牌失败时直接拒绝挂起请求且只触发单次重新认证',
    rejectsQueuedRequestsWhenRefreshFails,
  );
  it(
    '刷新令牌成功时携带新令牌重放当前与挂起请求',
    replaysQueuedRequestsWhenRefreshSucceeds,
  );
  it(
    '重放请求返回 500 时外层错误拦截器不再重复提示',
    suppressesDuplicateToastWhenReplayedRequestFails,
  );
  it(
    '刷新令牌失败已触发重认证时跳过外层冗余错误提示',
    suppressesRedundantToastsWhenRefreshFails,
  );
}

describe('authenticateResponseInterceptor', authenticateInterceptorSuite);

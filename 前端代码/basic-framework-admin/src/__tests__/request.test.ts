import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { rawHttp, request, resolveErrorMessage, unwrapBlobJsonError } from '@/api/request';
import { useUserStore } from '@/stores/user';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isPasswordChangeRequired,
  setTokens,
} from '@/utils/token';

describe('request error helpers', () => {
  it('unwraps JSON business error returned inside a Blob download response', async () => {
    const payload = JSON.stringify({ code: 403, data: null, msg: '无导出权限' });
    const resp = {
      data: new Blob([payload], { type: 'application/json' }),
      headers: { 'content-type': 'application/json;charset=UTF-8' },
    } as unknown as AxiosResponse;

    const err = await unwrapBlobJsonError(resp);
    expect(err).toEqual({ code: 403, data: null, msg: '无导出权限' });
  });

  it('returns null for normal binary Excel blobs', async () => {
    const resp = {
      data: new Blob(['PK\x03\x04binary'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      headers: { 'content-type': 'application/octet-stream' },
    } as unknown as AxiosResponse;

    expect(await unwrapBlobJsonError(resp)).toBeNull();
  });

  it('resolves user-facing error messages from server response or network error', () => {
    expect(
      resolveErrorMessage({ response: { data: { msg: '账号已锁定' } } }),
    ).toBe('账号已锁定');
    expect(resolveErrorMessage({ message: 'timeout of 30000ms exceeded' })).toBe(
      '请求超时，请稍后重试',
    );
    expect(resolveErrorMessage({ message: 'Network Error' })).toBe(
      '网络连接异常，请检查后端服务',
    );
  });
});

describe('refresh-token rotation keeps passwordChangeRequired aligned', () => {
  const PASSWORD_CHANGE_KEY = 'bf_password_change_required';
  const originalRawAdapter = rawHttp.defaults.adapter;
  let testPinia: ReturnType<typeof createPinia>;

  function ok(config: InternalAxiosRequestConfig, data: unknown): Promise<AxiosResponse> {
    return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });
  }

  async function rotateWith(refreshData: Record<string, unknown>) {
    const refreshBodies: unknown[] = [];
    const refreshAdapter: AxiosAdapter = (config) => {
      refreshBodies.push(JSON.parse(String(config.data)));
      return ok(config, { code: 0, data: refreshData, msg: '' });
    };
    rawHttp.defaults.adapter = refreshAdapter;
    const serviceAdapter: AxiosAdapter = (config) =>
      ok(
        config,
        config.headers.Authorization === 'Bearer new-access'
          ? { code: 0, data: 'retried', msg: '' }
          : { code: 401, data: null, msg: 'expired' },
      );
    const result = await request.get<string>('/synthetic/protected', {
      adapter: serviceAdapter,
    });
    return { result, refreshBodies };
  }

  function expectFlag(expected: boolean): void {
    expect(useUserStore(testPinia).passwordChangeRequired).toBe(expected);
    expect(isPasswordChangeRequired()).toBe(expected);
    expect(localStorage.getItem(PASSWORD_CHANGE_KEY)).toBe(String(expected));
  }

  beforeEach(() => {
    testPinia = createPinia();
    localStorage.clear();
    clearTokens();
  });

  afterEach(() => {
    rawHttp.defaults.adapter = originalRawAdapter;
    clearTokens();
  });

  it('applies passwordChangeRequired=true from the refresh response', async () => {
    setTokens('old-access', 'old-refresh', false);
    expectFlag(false);

    const { result, refreshBodies } = await rotateWith({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      passwordChangeRequired: true,
    });

    expect(result).toBe('retried');
    expect(refreshBodies).toEqual([{ refreshToken: 'old-refresh' }]);
    expect(getAccessToken()).toBe('new-access');
    expect(getRefreshToken()).toBe('new-refresh');
    expectFlag(true);
  });

  it('treats passwordChangeRequired=false from the refresh response as authoritative', async () => {
    setTokens('old-access', 'old-refresh', true);
    expectFlag(true);

    await rotateWith({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      passwordChangeRequired: false,
    });

    expect(getAccessToken()).toBe('new-access');
    expectFlag(false);
  });

  it('preserves the prior flag when the refresh response omits the field', async () => {
    setTokens('old-access', 'old-refresh', true);
    expectFlag(true);

    await rotateWith({ accessToken: 'new-access', refreshToken: 'new-refresh' });

    expect(getAccessToken()).toBe('new-access');
    expectFlag(true);
  });

  it('does not clear the flag when setTokens is called without one', () => {
    setTokens('old-access', 'old-refresh', true);

    setTokens('next-access', 'next-refresh');

    expectFlag(true);
  });
});

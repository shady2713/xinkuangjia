import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rawHttp, request, resolveErrorMessage, unwrapBlobJsonError } from '@/api/request';
import { useUserStore } from '@/stores/user';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isPasswordChangeRequired,
  passwordChangeRequiredFlag,
  setTokens,
} from '@/utils/token';

const SESSION_KEY = 'bf_session';
const LEGACY_KEYS = ['bf_access_token', 'bf_refresh_token', 'bf_password_change_required'];

function persistedSession(): unknown {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function currentSession() {
  return {
    accessToken: getAccessToken(),
    refreshToken: getRefreshToken(),
    passwordChangeRequired: isPasswordChangeRequired(),
  };
}

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
    expect(persistedSession()).toEqual(currentSession());
    LEGACY_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull());
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

describe('bf_session snapshot syncs across tabs', () => {
  const EMPTY = { accessToken: '', refreshToken: '', passwordChangeRequired: false };
  const login = {
    accessToken: 'b-access',
    refreshToken: 'b-refresh',
    passwordChangeRequired: true,
  };
  const rotated = {
    accessToken: 'b-access-2',
    refreshToken: 'b-refresh-2',
    passwordChangeRequired: false,
  };

  /** Mimics another tab: mutate shared storage, then deliver a real StorageEvent here. */
  function fromOtherTab(key: string | null, newValue: string | null): void {
    if (key === null) {
      localStorage.clear();
    } else if (newValue === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, newValue);
    }
    const setSpy = vi.spyOn(Storage.prototype, 'setItem');
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');
    window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
    const writes = setSpy.mock.calls.length + removeSpy.mock.calls.length;
    vi.restoreAllMocks();
    expect(writes).toBe(0);
  }

  beforeEach(() => {
    localStorage.clear();
    clearTokens();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTokens();
  });

  it('applies incoming login, rotation and logout from another tab', () => {
    setTokens('a-access', 'a-refresh', false);

    fromOtherTab(SESSION_KEY, JSON.stringify(login));
    expect(currentSession()).toEqual(login);
    expect(passwordChangeRequiredFlag.value).toBe(true);

    fromOtherTab(SESSION_KEY, JSON.stringify(rotated));
    expect(currentSession()).toEqual(rotated);
    expect(passwordChangeRequiredFlag.value).toBe(false);

    fromOtherTab(SESSION_KEY, null);
    expect(currentSession()).toEqual(EMPTY);

    fromOtherTab(SESSION_KEY, JSON.stringify(login));
    expect(currentSession()).toEqual(login);
    fromOtherTab(null, null);
    expect(currentSession()).toEqual(EMPTY);
  });

  it('rehydrates legacy keys read-only, then migrates on takeover and clears on logout', () => {
    fromOtherTab('bf_access_token', 'legacy-access');
    fromOtherTab('bf_refresh_token', 'legacy-refresh');
    fromOtherTab('bf_password_change_required', 'true');
    expect(currentSession()).toEqual({
      accessToken: 'legacy-access',
      refreshToken: 'legacy-refresh',
      passwordChangeRequired: true,
    });
    expect(persistedSession()).toBeNull();

    setTokens('own-access', 'own-refresh');
    const owned = {
      accessToken: 'own-access',
      refreshToken: 'own-refresh',
      passwordChangeRequired: true,
    };
    expect(currentSession()).toEqual(owned);
    expect(persistedSession()).toEqual(owned);
    LEGACY_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull());

    clearTokens();
    expect(currentSession()).toEqual(EMPTY);
    expect(persistedSession()).toBeNull();
  });
});

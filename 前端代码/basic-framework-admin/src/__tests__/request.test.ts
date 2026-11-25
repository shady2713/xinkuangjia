import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rawHttp, request, resolveErrorMessage, unwrapBlobJsonError } from '@/api/request';
import { useUserStore } from '@/stores/user';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getSessionId,
  isPasswordChangeRequired,
  loginSession,
  passwordChangeRequiredFlag,
  setLoginTokens,
  setTokens,
} from '@/utils/token';

const apiMocks = vi.hoisted(() => ({
  getPermissionInfoApi: vi.fn(),
  updateUserPasswordApi: vi.fn(),
}));

vi.mock('@/api/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/auth')>()),
  getPermissionInfoApi: apiMocks.getPermissionInfoApi,
}));
vi.mock('@/api/system/profile', () => ({
  updateUserPasswordApi: apiMocks.updateUserPasswordApi,
}));
vi.mock('@/utils/sm2', () => ({
  encryptPassword: async (value: string) => `enc:${value}`,
}));

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
    expect(persistedSession()).toEqual({ ...currentSession(), sessionId: getSessionId() });
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

it('keeps the platform of an active login through access token renewal', () => {
  clearTokens();
  try {
    expect(setLoginTokens('initial-access', 'session-refresh', false, null, 'business')).toBe(true);
    const owner = getSessionId()!;
    expect(setTokens('renewed-access', 'session-refresh', undefined, owner)).toBe(true);
    expect(loginSession.value.platform).toBe('business');
    expect(persistedSession()).toMatchObject({ loginPlatform: 'business' });
  } finally {
    clearTokens();
  }
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

    const legacyLogin = getSessionId();
    expect(legacyLogin).toBeTruthy();
    setTokens('own-access', 'own-refresh');
    expect(getSessionId()).toBe(legacyLogin);
    const owned = {
      accessToken: 'own-access',
      refreshToken: 'own-refresh',
      passwordChangeRequired: true,
    };
    expect(currentSession()).toEqual(owned);
    expect(persistedSession()).toEqual({ ...owned, sessionId: getSessionId() });
    LEGACY_KEYS.forEach((key) => expect(localStorage.getItem(key)).toBeNull());

    clearTokens();
    expect(currentSession()).toEqual(EMPTY);
    expect(persistedSession()).toBeNull();
  });
});

describe('refreshes stay with the login that started the requests', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  function reply(config: InternalAxiosRequestConfig, code: number, data: unknown): AxiosResponse {
    return { data: { code, data, msg: '' }, status: 200, statusText: 'OK', headers: {}, config };
  }

  const originalRawAdapter = rawHttp.defaults.adapter;

  beforeEach(() => {
    clearTokens();
  });

  afterEach(() => {
    rawHttp.defaults.adapter = originalRawAdapter;
    clearTokens();
  });

  it.each(['rotation', 'replacement-success', 'replacement-failure', 'logout'] as const)(
    'handles two requests during a normal %s',
    async (transition) => {
      setTokens('first-access', 'first-refresh', false);
      const initialLogin = getSessionId();
      const refreshStarted = deferred<void>();
      const finishRefresh = deferred<void>();
      const secondRequestStarted = deferred<void>();
      const seen: string[] = [];
      let rotationCount = 0;
      const replacement = transition.startsWith('replacement-');
      const refreshSucceeded = transition === 'rotation' || transition === 'replacement-success';
      rawHttp.defaults.adapter = async (config) => {
        rotationCount++;
        refreshStarted.resolve();
        await finishRefresh.promise;
        return reply(config, refreshSucceeded ? 0 : 401, {
          accessToken: 'rotated-access',
          refreshToken: 'rotated-refresh',
        });
      };

      const adapter: AxiosAdapter = async (config) => {
        const auth = String(config.headers.Authorization);
        seen.push(auth);
        if (config.url === '/second') secondRequestStarted.resolve();
        return reply(config, auth === 'Bearer first-access' ? 401 : 0, config.url);
      };
      const first = request.get('/first', { adapter });
      const second = request.get('/second', { adapter });
      const settled = Promise.allSettled([first, second]);
      await Promise.all([refreshStarted.promise, secondRequestStarted.promise]);

      if (replacement) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          accessToken: 'peer-access',
          refreshToken: 'peer-refresh',
          passwordChangeRequired: false,
          sessionId: 'peer-login',
        }));
        // A pending StorageEvent need not have reached this tab yet.
      }
      if (transition === 'logout') clearTokens();
      finishRefresh.resolve();
      const outcome = await settled;
      expect(rotationCount).toBe(1);
      if (transition === 'rotation') {
        expect(outcome.map((item) => item.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(seen).toEqual([
          'Bearer first-access', 'Bearer first-access', 'Bearer rotated-access', 'Bearer rotated-access',
        ]);
        expect(getSessionId()).toBe(initialLogin);
      } else {
        expect(outcome.map((item) => item.status)).toEqual(['rejected', 'rejected']);
        expect(seen).toEqual(['Bearer first-access', 'Bearer first-access']);
        expect(getAccessToken()).toBe(replacement ? 'peer-access' : '');
      }
    },
  );

  it('does not clear or navigate a session when an anonymous request is denied', async () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const navigate = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    const rotate = vi.fn();
    rawHttp.defaults.adapter = rotate;
    try {
      await expect(request.get('/synthetic/current-user', {
        adapter: async (config) => reply(config, 401, null),
      })).rejects.toThrow('请先登录');
      expect(removeItem).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(rotate).not.toHaveBeenCalled();
    } finally {
      navigate.mockRestore();
      removeItem.mockRestore();
    }
  });

  it('checks the original login before a queued request reaches its adapter', async () => {
    setLoginTokens('first-access', 'first-refresh', false);
    const adapter = vi.fn();
    const pending = request.get('/synthetic/current-user', { adapter });
    setLoginTokens('second-access', 'second-refresh', false);

    await expect(pending).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('keeps a same-login rotation in another tab without a second rotation', async () => {
    setTokens('first-access', 'first-refresh');
    const sessionId = getSessionId();
    const sent = deferred<void>();
    const finish = deferred<void>();
    const rotate = vi.fn();
    rawHttp.defaults.adapter = rotate;
    const credentials: string[] = [];
    const response = request.get<string>('/synthetic/current-user', {
      adapter: async (config) => {
        const auth = String(config.headers.Authorization);
        credentials.push(auth);
        if (auth === 'Bearer first-access') {
          sent.resolve();
          await finish.promise;
          return reply(config, 401, null);
        }
        return reply(config, 0, 'same login');
      },
    });
    await sent.promise;
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      sessionId,
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
      passwordChangeRequired: false,
    }));
    finish.resolve();
    await expect(response).resolves.toBe('same login');
    expect(rotate).not.toHaveBeenCalled();
    expect(credentials).toEqual(['Bearer first-access', 'Bearer rotated-access']);
  });
});

describe('self-service store actions stay with the current login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearTokens();
  });

  afterEach(() => {
    clearTokens();
  });

  it('refreshes identity without replacing permissions or menus', async () => {
    setLoginTokens('first-access', 'first-refresh', false);
    const store = useUserStore(createPinia());
    store.permissions = ['kept:permission'];
    apiMocks.getPermissionInfoApi.mockResolvedValue({
      user: { nickname: 'updated' },
      roles: [],
      permissions: [],
      menus: [],
    });

    await store.refreshUserInfo();

    expect(store.userInfo).toEqual({ nickname: 'updated' });
    expect(store.permissions).toEqual(['kept:permission']);
    expect(store.menus).toEqual([]);
  });

  it('does not submit a self password change once the bound login is replaced', async () => {
    setLoginTokens('first-access', 'first-refresh', false);
    const owner = getSessionId();
    const store = useUserStore(createPinia());
    apiMocks.updateUserPasswordApi.mockResolvedValue(true);
    setLoginTokens('second-access', 'second-refresh', false);

    await expect(store.changeOwnPassword(owner, 'Old-pass1', 'New-pass1')).resolves.toBe(false);
    expect(apiMocks.updateUserPasswordApi).not.toHaveBeenCalled();
  });

  it('submits encrypted values for the current login', async () => {
    setLoginTokens('first-access', 'first-refresh', false);
    const owner = getSessionId();
    const store = useUserStore(createPinia());
    apiMocks.updateUserPasswordApi.mockResolvedValue(true);

    await expect(store.changeOwnPassword(owner, 'Old-pass1', 'New-pass1')).resolves.toBe(true);
    expect(apiMocks.updateUserPasswordApi).toHaveBeenCalledWith({
      oldPassword: 'enc:Old-pass1',
      newPassword: 'enc:New-pass1',
    });
  });
});

describe('multi-tab concurrent refresh prioritization', () => {
  const originalRawAdapter = rawHttp.defaults.adapter;

  beforeEach(() => {
    clearTokens();
  });

  afterEach(() => {
    rawHttp.defaults.adapter = originalRawAdapter;
    clearTokens();
  });

  it('installs own newly minted access token even if a peer tab rotated during flight', async () => {
    setTokens('old-access', 'shared-refresh', false);
    const sid = getSessionId()!;
    let attempts = 0;

    rawHttp.defaults.adapter = async (config) => {
      // Simulate peer tab writing its own token while our refresh is in flight
      setTokens('peer-revoked-access', 'shared-refresh', false, sid);
      return {
        data: {
          code: 0,
          data: { accessToken: 'our-fresh-access', refreshToken: 'shared-refresh' },
          msg: '',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    const result = await request.get<string>('/demo', {
      adapter: async (config) => {
        attempts += 1;
        const auth = String(config.headers?.Authorization ?? '');
        if (attempts === 1) {
          return { data: { code: 401, data: null, msg: 'expired' }, status: 200, statusText: 'OK', headers: {}, config };
        }
        return { data: { code: 0, data: auth, msg: '' }, status: 200, statusText: 'OK', headers: {}, config };
      },
    });

    expect(result).toBe('Bearer our-fresh-access');
    expect(getAccessToken()).toBe('our-fresh-access');
  });
});

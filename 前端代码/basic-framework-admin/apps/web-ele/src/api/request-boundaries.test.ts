/**
 * 应用请求边界（api/request.ts）的真实行为回归。
 *
 * 该模块决定认证失效如何退出、刷新令牌缺失如何失败、请求密文与响应密文如何走通，
 * 以及旧身份失败与业务错误文案如何隔离。用例使用真实请求客户端与真实拦截器链，
 * 只替换传输适配器（不下发网络请求）、偏好、认证 Store、刷新接口与提示渠道。
 */
import type { AxiosResponse, InternalAxiosRequestConfig } from '@vben/request';

import { useAccessStore } from '@vben/stores';
import { createApiEncrypt } from '@vben/utils';

import {
  createPinia,
  disposePinia,
  getActivePinia,
  setActivePinia,
} from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 加密头名称，与运行时配置保持一致。 */
const ENCRYPT_HEADER = 'X-Api-Encrypt';

/** 恢复真实传输适配器的清理动作。 */
type RestoreAdapter = () => void;

/** 用例可变的偏好开关与外部边界替身。 */
const state = vi.hoisted(
  /** 建立跨用例共享的偏好开关容器。 */
  () => ({ enableRefreshToken: false }),
);

/** 外部边界的记录型替身：退出、刷新接口与提示渠道。 */
const spies = vi.hoisted(
  /** 建立跨用例共享的替身容器。 */
  () => ({
    logout: vi.fn(),
    refreshTokenApi: vi.fn(),
    showErrorMessage: vi.fn(),
  }),
);

vi.hoisted(
  /**
   * 请求客户端在模块加载期读取偏好与加密环境变量，必须在导入前固定这些取值。
   */
  () => {
    vi.stubEnv('VITE_APP_API_ENCRYPT_ALGORITHM', 'AES');
    vi.stubEnv('VITE_APP_API_ENCRYPT_ENABLE', 'true');
    vi.stubEnv('VITE_APP_API_ENCRYPT_HEADER', 'X-Api-Encrypt');
    // 请求与响应使用同一测试密钥，才能断言完整加解密往返链路。
    vi.stubEnv('VITE_APP_API_ENCRYPT_REQUEST_KEY', 'DUMMY-shared-key');
    vi.stubEnv('VITE_APP_API_ENCRYPT_RESPONSE_KEY', 'DUMMY-shared-key');
  },
);

vi.mock(
  '@vben/hooks',
  /** 固定接口根地址，避免依赖运行时配置脚本。 */ () => ({
    /** 返回测试用接口根地址。 */ useAppConfig: () => ({ apiURL: '/api' }),
  }),
);

vi.mock(
  '@vben/preferences',
  /** 保留可切换的刷新开关，语言只影响请求头。 */ () => ({
    preferences: {
      /**
       * 每次读取都返回当前开关，便于同一文件覆盖两条刷新分支。
       * @returns 当前偏好开关与语言值。
       */
      get app() {
        return {
          enableRefreshToken: state.enableRefreshToken,
          locale: 'zh-CN',
        };
      },
    },
  }),
);

vi.mock(
  './core',
  /** 只替换刷新接口边界，保留真实刷新编排。 */ () => ({
    refreshTokenApi: spies.refreshTokenApi,
  }),
);

vi.mock(
  '#/store',
  /** 只记录失效退出副作用，不创建依赖应用启动的认证 Store。 */ () => ({
    /** 返回可观测的退出边界。 */ useAuthStore: () => ({
      logout: spies.logout,
    }),
  }),
);

vi.mock(
  '@vben/locales',
  /** 只替换文案函数，让兜底提示可精确断言。 */ () => ({
    /**
     * 按固定前缀返回文案，便于断言兜底提示来源。
     * @param key 文案键。
     * @returns 带前缀的文案文本。
     */
    $t: (key: string) => `i18n:${key}`,
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 只替换提示渠道，保留真实错误文案归一化。 */ async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/utils/feedback')>();
    return { ...actual, showErrorMessage: spies.showErrorMessage };
  },
);

/**
 * 构造保留原始请求配置的标准响应。
 * @param config 触发本次响应的请求配置。
 * @param data 响应体。
 * @param headers 响应头。
 * @returns 满足传输层契约的响应对象。
 */
function response(
  config: InternalAxiosRequestConfig,
  data: unknown,
  headers: Record<string, string> = {},
): AxiosResponse {
  return { config, data, headers, status: 200, statusText: 'OK' };
}

/**
 * 构造携带响应外壳的传输失败对象。
 * @param config 触发本次失败的请求配置。
 * @param data 响应体。
 * @param status HTTP 状态码。
 * @returns 与 axios 错误形状一致、可被真实拦截器识别的失败对象。
 */
function transportError(
  config: InternalAxiosRequestConfig,
  data: unknown,
  status = 500,
) {
  return {
    config,
    message: 'Request failed',
    response: { config, data, headers: {}, status, statusText: 'error' },
  };
}

/**
 * 加载同一模块实例下的请求客户端与会话工具，避免重载后代次不同步。
 * @returns 真实请求客户端与配套的会话工具。
 */
async function loadBoundary() {
  vi.resetModules();
  const session = await import('#/utils/auth-session');
  const { requestClient } = await import('./request');
  return { requestClient, session };
}

describe('请求边界真实行为', /** 认证失效、刷新与加解密链路的漏洞会直接泄漏数据或让请求卡死。 */ () => {
  /** 每例恢复被替换的传输适配器，避免真实网络请求外泄。 */
  let restoreAdapter: RestoreAdapter | undefined;

  beforeEach(
    /** 建立独立身份、清空替身记录并固定加密环境。 */ () => {
      setActivePinia(createPinia());
      spies.logout.mockClear();
      spies.refreshTokenApi.mockReset();
      spies.showErrorMessage.mockClear();
      vi.stubEnv('VITE_APP_API_ENCRYPT_REQUEST_KEY', 'DUMMY-shared-key');
      vi.spyOn(console, 'error').mockImplementation(
        /** 失败日志不是本用例的断言目标，避免污染测试输出。 */ () => {},
      );
      vi.spyOn(console, 'warn').mockImplementation(
        /** 过期提示不是本用例的断言目标。 */ () => {},
      );
    },
  );

  afterEach(
    /** 恢复适配器、控制台与测试 Store。 */ () => {
      restoreAdapter?.();
      vi.restoreAllMocks();
      const pinia = getActivePinia();
      if (pinia) disposePinia(pinia);
    },
  );

  it('未开启自动刷新时未授权响应触发真实退出', /** 失效后不退出会让用户停留在报错页面并反复重试。 */ async () => {
    state.enableRefreshToken = false;
    const { requestClient } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter =
      /** 返回业务码 401 的未授权响应。 */ async (config) =>
        response(config, { code: 401 });
    useAccessStore().setAccessToken('test-token');

    await expect(requestClient.get('/private')).rejects.toBeDefined();

    expect(spies.logout).toHaveBeenCalledTimes(1);
    // 401 已由退出流程处理，不再重复提示。
    expect(spies.showErrorMessage).not.toHaveBeenCalled();
  });

  it('刷新令牌缺失时明确失败并退出', /** 缺少刷新令牌时静默重试会让请求悬挂在刷新等待里。 */ async () => {
    state.enableRefreshToken = true;
    const { requestClient } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter =
      /** 返回业务码 401 的未授权响应。 */ async (config) =>
        response(config, { code: 401 });
    useAccessStore().setAccessToken('test-token');
    useAccessStore().setRefreshToken(null);

    await expect(requestClient.get('/private')).rejects.toThrow(
      'Refresh token is null!',
    );

    expect(spies.refreshTokenApi).not.toHaveBeenCalled();
    expect(spies.logout).toHaveBeenCalledTimes(1);
  });

  it('开启加密后请求体真实加密、响应体真实解密', /** 加密开关不生效会把明文发到服务端，解密不生效会让页面拿不到业务数据。 */ async () => {
    state.enableRefreshToken = true;
    const { requestClient } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    const apiEncrypt = createApiEncrypt(import.meta.env);
    const sent: InternalAxiosRequestConfig[] = [];
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter =
      /** 记录加密后的请求体并返回真实密文响应。 */ async (config) => {
        sent.push(config);
        return response(
          config,
          apiEncrypt.encryptRequest({ code: 0, data: 'secret' }),
          { [ENCRYPT_HEADER]: 'true' },
        );
      };
    useAccessStore().setAccessToken('test-token');

    await expect(
      requestClient.post('/private', { name: '明文内容' }, {
        headers: { isEncrypt: true },
      } as never),
    ).resolves.toBe('secret');

    const request = sent[0];
    expect(request?.headers[ENCRYPT_HEADER]).toBe('true');
    expect(typeof request?.data).toBe('string');
    expect(String(request?.data)).not.toContain('明文内容');
  });

  it('响应密文无法解密时明确失败', /** 解密失败被吞掉会让业务拿到密文或空数据。 */ async () => {
    state.enableRefreshToken = true;
    const { requestClient } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter =
      /** 返回声明为密文但无法解码的响应体。 */ async (config) =>
        response(config, 'not-a-ciphertext', { [ENCRYPT_HEADER]: 'true' });
    useAccessStore().setAccessToken('test-token');

    await expect(requestClient.get('/private')).rejects.toThrow(
      '响应数据解密失败',
    );
  });

  it('请求加密失败时阻断发送', /** 加密失败仍放行会把明文发出去，必须在发送前中断。 */ async () => {
    state.enableRefreshToken = true;
    vi.stubEnv('VITE_APP_API_ENCRYPT_REQUEST_KEY', '');
    const { requestClient } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    const adapter = vi.fn(
      /** 若请求错误地到达传输层则返回可识别结果。 */ async (config) =>
        response(config, { code: 0, data: 'unexpected' }),
    );
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter = adapter;
    useAccessStore().setAccessToken('test-token');

    await expect(
      requestClient.post('/private', { name: '明文内容' }, {
        headers: { isEncrypt: true },
      } as never),
    ).rejects.toThrow('AES 请求加密密钥未配置');

    expect(adapter).not.toHaveBeenCalled();
  });

  it('旧身份失败不得让新身份承担后果', /** 旧请求失败被当成当前身份失败会注销刚登录的新账号。 */ async () => {
    state.enableRefreshToken = true;
    const { requestClient, session } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter =
      /** 请求已发出后切换身份，再让传输失败。 */ async (config) => {
        session.advanceSession();
        throw transportError(config, { code: 500, message: '服务器错误' });
      };
    useAccessStore().setAccessToken('test-token');

    await expect(requestClient.get('/private')).rejects.toMatchObject({
      name: 'SessionChangedError',
    });

    expect(spies.logout).not.toHaveBeenCalled();
  });

  it('业务错误优先使用服务端文案', /** 只显示状态码兜底会让用户看不到真实失败原因。 */ async () => {
    state.enableRefreshToken = true;
    const { requestClient } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter =
      /** 返回带业务文案的服务端错误。 */ async (config) => {
        throw transportError(config, { code: 500, message: '后端服务繁忙' });
      };
    useAccessStore().setAccessToken('test-token');

    await expect(requestClient.get('/private')).rejects.toBeDefined();

    expect(spies.showErrorMessage).toHaveBeenCalledWith('后端服务繁忙');
  });

  it('非字符串文案回退到状态码提示', /** 服务端返回数字文案时不能把数字当提示内容渲染。 */ async () => {
    state.enableRefreshToken = true;
    const { requestClient } = await loadBoundary();
    const original = requestClient.instance.defaults.adapter;
    restoreAdapter = /** 恢复真实传输配置。 */ () => {
      requestClient.instance.defaults.adapter = original;
    };
    requestClient.instance.defaults.adapter =
      /** 返回数字文案的服务端错误。 */ async (config) => {
        throw transportError(config, { code: 500, message: 50_000 });
      };
    useAccessStore().setAccessToken('test-token');

    await expect(requestClient.get('/private')).rejects.toBeDefined();

    expect(spies.showErrorMessage).toHaveBeenCalledWith(
      'i18n:ui.fallback.http.internalServerError',
    );
  });
});

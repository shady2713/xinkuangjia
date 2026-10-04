/**
 * 请求预设拦截器（preset-interceptors.ts）的真实行为回归。
 *
 * 覆盖三组职责：
 * ① 标准业务解包：raw/body/data 三种返回模式、函数形态的成功判定与数据选择器；
 * ② 认证失败拦截：明确禁止刷新或已是重试请求时，直接结束身份并保留原错误；
 * ③ 错误提示映射：传输取消、网络错误、超时与各状态码对应的提示文案键。
 * 前两组用真实响应外壳与真实请求链路驱动，第三组只替换文案目录这一外部边界。
 */
import type { RequestResponse } from './types';

import { AxiosHeaders } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { describe, expect, it, vi } from 'vitest';

import {
  authenticateResponseInterceptor,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
} from './preset-interceptors';
import { RequestClient } from './request-client';

vi.mock(
  '@vben/locales',
  /** 文案目录属于语言包边界，这里用键名回显，便于核对每个失败对应的文案键。 */ () => ({
    /** 原样返回文案键，断言因此能锁定具体键名。 */
    $t: (key: string) => key,
  }),
);

/**
 * 构造满足响应外壳校验的最小请求配置。
 * @param overrides 需要覆盖的配置字段。
 * @returns 带 Axios 请求头的配置对象。
 */
function config(overrides: Record<string, unknown> = {}) {
  return { headers: new AxiosHeaders(), url: '/api/items', ...overrides };
}

/**
 * 构造满足响应外壳校验的最小响应。
 * @param overrides 需要覆盖的响应字段。
 * @returns 可作为 RequestResponse 使用的响应对象。
 */
function response(overrides: Record<string, unknown> = {}): RequestResponse {
  return {
    config: config(),
    data: { code: 0, data: { id: 1 } },
    headers: new AxiosHeaders(),
    status: 200,
    statusText: 'OK',
    ...overrides,
  } as unknown as RequestResponse;
}

/**
 * 构造带响应外壳的请求失败。
 * @param failureResponse 失败响应。
 * @param message 传输层错误信息。
 * @returns 形状与 Axios 错误一致的失败对象。
 */
function failure(
  failureResponse?: RequestResponse,
  message = 'request failed',
) {
  return Object.assign(new Error(message), { response: failureResponse });
}

describe('defaultResponseInterceptor 解包模式', /** 三种返回模式与函数形态的判定。 */ () => {
  it('raw 模式原样返回完整响应', /** 需要响应头或状态时调用方要拿到完整外壳，不能只给业务数据。 */ () => {
    const raw = response({ config: config({ responseReturn: 'raw' }) });
    const interceptor = defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 0,
    });

    expect(interceptor.fulfilled?.(raw)).toBe(raw);
  });

  it('body 模式返回未解包的响应体', /** 业务码非零但需要自行处理的接口依赖响应体。 */ () => {
    const body = response({
      config: config({ responseReturn: 'body' }),
      data: { code: 500, message: '业务失败' },
    });
    const interceptor = defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 0,
    });

    expect(interceptor.fulfilled?.(body)).toEqual({
      code: 500,
      message: '业务失败',
    });
  });

  it('成功判定可以用函数表达', /** 不同后端的成功码不统一，函数形态必须真正参与判定。 */ () => {
    const interceptor = defaultResponseInterceptor({
      codeField: 'status',
      dataField: 'data',
      /** 以字符串 OK 表示成功，覆盖非数字成功码的后端。 */
      successCode: (code) => code === 'OK',
    });

    expect(
      interceptor.fulfilled?.(
        response({ data: { data: { id: 9 }, status: 'OK' } }),
      ),
    ).toEqual({ id: 9 });
    expect(
      /** 用非成功业务码调用解包处理器。 */ () =>
        interceptor.fulfilled?.(
          response({ data: { data: { id: 9 }, status: 'FAIL' } }),
        ),
    ).toThrow();
  });

  it('数据选择器可以用函数表达', /** 数据不在固定字段时需要由调用方决定取值位置。 */ () => {
    const interceptor = defaultResponseInterceptor({
      codeField: 'code',
      /** 从嵌套位置取业务数据。 */
      dataField: (body) => (body.result as { id: number }).id,
      successCode: 0,
    });

    expect(
      interceptor.fulfilled?.(
        response({ data: { code: 0, result: { id: 7 } } }),
      ),
    ).toBe(7);
  });

  it('传输状态异常时抛出携带完整响应的错误', /** 错误链需要拿到响应才能区分网络失败与业务失败。 */ () => {
    const interceptor = defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 0,
    });
    const failed = response({ status: 500 });

    expect(
      /** 用传输状态异常的响应调用解包处理器。 */ () =>
        interceptor.fulfilled?.(failed),
    ).toThrow();
    try {
      interceptor.fulfilled?.(failed);
    } catch (error) {
      // 抛出的错误必须携带原始响应，错误提示与重试逻辑都依赖它。
      expect((error as { response: RequestResponse }).response).toBe(failed);
    }
  });
});

describe('authenticateResponseInterceptor 终止刷新', /** 明确不允许刷新时直接结束身份。 */ () => {
  it('关闭刷新后未授权请求直接结束身份并保留原错误', /** 未开启刷新能力时不能重发请求，必须结束身份并由调用方处理失败。 */ async () => {
    const client = new RequestClient({
      /** 固定本例请求所属的会话代次。 */ getSessionEpoch: () => 7,
    });
    const mock = new MockAdapter(client.instance);
    const reAuthenticate = vi.fn(
      /** 记录结束身份调用，不执行页面跳转。 */ async () => {},
    );
    const refresh = vi.fn();
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        doReAuthenticate: reAuthenticate,
        doRefreshToken: refresh,
        enableRefreshToken: false,
        /** 原样编码令牌，本组不会触发刷新。 */ formatToken: (token) => token,
        /** 返回与请求一致的会话代次。 */ getSessionEpoch: () => 7,
      }),
    );
    mock.onGet('/no-refresh').reply(401);

    await expect(client.get('/no-refresh')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(reAuthenticate).toHaveBeenCalledWith(7);
    expect(refresh).not.toHaveBeenCalled();
    // 未授权请求不得重发。
    expect(mock.history.get).toHaveLength(1);

    mock.restore();
  });

  it('已重试过的未授权请求不再刷新', /** 重试标记用于防止无限刷新，必须真实生效。 */ async () => {
    const client = new RequestClient({
      /** 固定本例请求所属的会话代次。 */ getSessionEpoch: () => 3,
    });
    const mock = new MockAdapter(client.instance);
    const reAuthenticate = vi.fn(
      /** 记录结束身份调用，不执行页面跳转。 */ async () => {},
    );
    const refresh = vi.fn();
    client.addResponseInterceptor(
      authenticateResponseInterceptor({
        client,
        doReAuthenticate: reAuthenticate,
        doRefreshToken: refresh,
        enableRefreshToken: true,
        /** 原样编码令牌，本组不会触发刷新。 */ formatToken: (token) => token,
        /** 返回与请求一致的会话代次。 */ getSessionEpoch: () => 3,
      }),
    );
    mock.onGet('/retried').reply(401);

    await expect(
      client.get('/retried', { __isRetryRequest: true } as never),
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(reAuthenticate).toHaveBeenCalledWith(3);
    expect(refresh).not.toHaveBeenCalled();
    expect(mock.history.get).toHaveLength(1);

    mock.restore();
  });
});

describe('errorMessageResponseInterceptor 提示映射', /** 失败类型到提示文案键的映射。 */ () => {
  it('取消的请求不产生提示', /** 主动取消不是失败，提示会打扰用户。 */ async () => {
    const makeErrorMessage = vi.fn();
    const interceptor = errorMessageResponseInterceptor(makeErrorMessage);
    const canceled = Object.assign(new Error('canceled'), {
      __CANCEL__: true,
    });

    await expect(interceptor.rejected?.(canceled)).rejects.toBe(canceled);
    expect(makeErrorMessage).not.toHaveBeenCalled();
  });

  it('网络错误与超时使用专用文案', /** 这两类失败没有响应状态，只能按传输错误信息区分。 */ async () => {
    const makeErrorMessage = vi.fn();
    const interceptor = errorMessageResponseInterceptor(makeErrorMessage);

    const networkError = new Error('Network Error');
    await expect(interceptor.rejected?.(networkError)).rejects.toBe(
      networkError,
    );
    expect(makeErrorMessage).toHaveBeenLastCalledWith(
      'ui.fallback.http.networkError',
      networkError,
    );

    const timeoutError = new Error('timeout of 5000ms exceeded');
    await expect(interceptor.rejected?.(timeoutError)).rejects.toBe(
      timeoutError,
    );
    expect(makeErrorMessage).toHaveBeenLastCalledWith(
      'ui.fallback.http.requestTimeout',
      timeoutError,
    );
  });

  it.each([
    [400, 'ui.fallback.http.badRequest'],
    [401, 'ui.fallback.http.unauthorized'],
    [403, 'ui.fallback.http.forbidden'],
    [404, 'ui.fallback.http.notFound'],
    [408, 'ui.fallback.http.requestTimeout'],
    [500, 'ui.fallback.http.internalServerError'],
  ])(
    '状态码 %s 使用对应文案',
    /** 每个 HTTP 状态都必须映射到明确的提示文案键。 */ async (status, key) => {
      const makeErrorMessage = vi.fn();
      const interceptor = errorMessageResponseInterceptor(makeErrorMessage);
      // 响应体不带业务码，状态码才能决定映射结果。
      const failed = failure(response({ data: {}, status }));

      await expect(interceptor.rejected?.(failed)).rejects.toBe(failed);
      expect(makeErrorMessage).toHaveBeenCalledWith(key, failed);
    },
  );

  it('业务码优先于 HTTP 状态决定文案', /** 框架把业务码放在响应体里，提示必须与业务码一致。 */ async () => {
    const makeErrorMessage = vi.fn();
    const interceptor = errorMessageResponseInterceptor(makeErrorMessage);
    const failed = failure(response({ data: { code: 403 }, status: 500 }));

    await expect(interceptor.rejected?.(failed)).rejects.toBe(failed);
    expect(makeErrorMessage).toHaveBeenCalledWith(
      'ui.fallback.http.forbidden',
      failed,
    );
  });

  it('无响应外壳的失败使用服务端错误文案', /** 普通异常没有状态码，仍要给出稳定的兜底提示。 */ async () => {
    const makeErrorMessage = vi.fn();
    const interceptor = errorMessageResponseInterceptor(makeErrorMessage);
    const plainFailure = { message: 42 };

    await expect(interceptor.rejected?.(plainFailure)).rejects.toBe(
      plainFailure,
    );
    expect(makeErrorMessage).toHaveBeenCalledWith(
      'ui.fallback.http.internalServerError',
      plainFailure,
    );
  });

  it('未提供提示渠道时仍拒绝原错误', /** 提示渠道是可选的，缺少它不能把失败转成成功。 */ async () => {
    const interceptor = errorMessageResponseInterceptor();
    const failed = failure(response({ status: 404 }));

    await expect(interceptor.rejected?.(failed)).rejects.toBe(failed);
  });
});

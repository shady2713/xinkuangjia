/**
 * Axios 请求封装：统一 Bearer 鉴权、401 单飞刷新令牌队列、CommonResult 解包、Blob 错误解析与文件下载。
 */
import axios, {
  CanceledError,
  type AxiosError,
  type AxiosInstance,
  type AxiosProgressEvent,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { ElMessage } from 'element-plus';

import type { OpenApiSchemas } from '@/api/generated/api-types';

import { getAppConfig } from '@/config/app';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  getSessionId,
  loginSession,
  loginPlatformQuery,
  setTokens,
} from '@/utils/token';

export interface CommonResult<T = unknown> {
  code: number;
  data: T;
  msg: string;
}

export interface PageParam {
  pageNo?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export interface PageResult<T> {
  list: T[];
  total: number;
}

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
  _silent?: boolean;
  /** Login bound when the request was invoked; null means signed out. */
  _sessionId?: string | null;
  /** Access token actually sent on this attempt. */
  _bearer?: string;
}

interface SessionBoundConfig extends AxiosRequestConfig {
  _sessionId?: string | null;
}

const { apiBaseUrl } = getAppConfig();

/** 原始实例：用于 refreshToken、logout 与 captcha 等不经通用解包的接口。 */
export const rawHttp: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30_000,
});

/** 标准业务请求实例。 */
const service: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  timeout: 30_000,
});

/** Rejects with a CanceledError when the bound login was replaced or signed out. */
function assertCurrent(config: RetryableRequestConfig): void {
  if (getSessionId() !== (config._sessionId ?? null)) {
    throw new CanceledError('登录会话已切换');
  }
}

/** Binds the current login at invocation; the interceptor may run later. */
function bindSession(config?: AxiosRequestConfig): AxiosRequestConfig {
  const bound: SessionBoundConfig = { ...config, _sessionId: getSessionId() };
  return bound;
}

/** One pending rotation per login; waiters share it. */
const refreshes = new Map<string, Promise<string | null>>();

function refreshFor(sessionId: string): Promise<string | null> {
  const existing = refreshes.get(sessionId);
  if (existing) {
    return existing;
  }
  const pending = performRefreshToken(sessionId).finally(() => {
    if (refreshes.get(sessionId) === pending) {
      refreshes.delete(sessionId);
    }
  });
  refreshes.set(sessionId, pending);
  return pending;
}

async function performRefreshToken(sessionId: string): Promise<string | null> {
  if (getSessionId() !== sessionId) {
    return null;
  }
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }
  const previousAccessToken = getAccessToken();
  let body: CommonResult<Partial<OpenApiSchemas.AuthLoginRespVO>> | undefined;
  let transportFailure: unknown;
  try {
    const resp = await rawHttp.post<CommonResult<Partial<OpenApiSchemas.AuthLoginRespVO>>>(
      '/system/auth/refresh-token',
      { refreshToken },
    );
    body = resp.data;
  } catch (error) {
    // A peer may have completed a refresh while this request was in flight.
    transportFailure = error;
  }
  if (getSessionId() !== sessionId) {
    return null;
  }
  const currentAccessToken = getAccessToken();
  if (currentAccessToken !== previousAccessToken || getRefreshToken() !== refreshToken) {
    return currentAccessToken || null;
  }
  if (transportFailure) {
    const status = axios.isAxiosError(transportFailure) ? transportFailure.response?.status : undefined;
    if (status === 401 || status === 403) return null;
    throw transportFailure;
  }
  if (body?.code === 400 || body?.code === 401 || body?.code === 403) return null;
  if (body?.code !== 0 || !body.data?.accessToken) {
    throw new Error(body?.msg || '暂时无法刷新会话，请稍后重试');
  }
  const installed = setTokens(
    body.data.accessToken,
    body.data.refreshToken || refreshToken,
    body.data.passwordChangeRequired,
    sessionId,
  );
  return installed ? body.data.accessToken : null;
}

function redirectToLogin(sessionId: string | null): void {
  const query = loginPlatformQuery(loginSession.value.platform);
  if (!clearTokens(sessionId)) {
    throw new CanceledError('登录会话已切换');
  }
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const loginUrl = `${base}/login`;
  if (!window.location.pathname.endsWith('/login')) {
    const redirect = window.location.pathname.replace(base, '') + window.location.search + window.location.hash;
    window.location.replace(`${loginUrl}?${new URLSearchParams({ ...query, redirect })}`);
  }
}

/**
 * 解析下载接口误返回的 JSON 错误 Blob，避免把错误提示当成文件保存。
 */
export async function unwrapBlobJsonError(
  response: AxiosResponse,
): Promise<CommonResult | null> {
  const data = response.data;
  if (!(data instanceof Blob)) {
    return null;
  }
  const contentType = String(response.headers?.['content-type'] ?? '');
  if (!contentType.includes('application/json') && !contentType.includes('text/json')) {
    return null;
  }
  try {
    const text = await data.text();
    const parsed = JSON.parse(text) as CommonResult;
    if (typeof parsed?.code === 'number') {
      return parsed;
    }
  } catch {
    // 非法 JSON 忽略，按普通二进制处理
  }
  return null;
}

/**
 * 统一提取面向用户的可读错误消息。
 */
export function resolveErrorMessage(error: unknown, fallback = '请求失败，请稍后重试'): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const err = error as AxiosError<CommonResult>;
    const serverMsg = err.response?.data?.msg;
    if (typeof serverMsg === 'string' && serverMsg.trim()) {
      return serverMsg;
    }
    if (typeof err.message === 'string' && err.message.trim()) {
      if (err.message.includes('timeout')) return '请求超时，请稍后重试';
      if (err.message.includes('Network Error')) return '网络连接异常，请检查后端服务';
      return err.message;
    }
  }
  return fallback;
}

service.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const bound = config as RetryableRequestConfig;
  assertCurrent(bound);
  const token = getAccessToken();
  bound._bearer = token;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

async function handleUnauthorized(
  originalConfig: RetryableRequestConfig,
): Promise<AxiosResponse> {
  assertCurrent(originalConfig);
  const sessionId = originalConfig._sessionId ?? null;
  if (originalConfig._retried) {
    if (getAccessToken() === originalConfig._bearer) redirectToLogin(sessionId);
    return Promise.reject(new Error('登录状态已过期，请重新登录'));
  }
  originalConfig._retried = true;

  // A late 401 for the previous bearer reuses the already rotated token without refreshing.
  let newToken: string | null = getAccessToken() || null;
  if (!newToken || newToken === originalConfig._bearer) {
    newToken = sessionId ? await refreshFor(sessionId) : null;
    assertCurrent(originalConfig);
  }
  if (!newToken) {
    redirectToLogin(sessionId);
    return Promise.reject(new Error('登录状态已过期，请重新登录'));
  }
  return service(originalConfig);
}

service.interceptors.response.use(
  async (response: AxiosResponse) => {
    const config = response.config as RetryableRequestConfig;
    assertCurrent(config);
    if (config.responseType === 'blob') {
      const jsonErr = await unwrapBlobJsonError(response);
      assertCurrent(config);
      if (jsonErr && jsonErr.code !== 0) {
        if (jsonErr.code === 401) {
          return handleUnauthorized(config);
        }
        const msg = jsonErr.msg || '导出失败';
        if (!config._silent) ElMessage.error(msg);
        return Promise.reject(new Error(msg));
      }
      return response.data;
    }

    const body = response.data as CommonResult;
    if (body && typeof body.code === 'number') {
      if (body.code === 0) {
        return body.data as any;
      }
      if (body.code === 401) {
        return handleUnauthorized(config);
      }
      const msg = body.msg || '操作失败';
      if (!config._silent) ElMessage.error(msg);
      return Promise.reject(new Error(msg));
    }
    return response.data;
  },
  async (error: AxiosError<CommonResult>) => {
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }
    const config = error.config as RetryableRequestConfig | undefined;
    if (config) {
      assertCurrent(config);
    }
    if (error.response?.status === 401 && config) {
      return handleUnauthorized(config);
    }
    const msg = resolveErrorMessage(error);
    if (!config?._silent) {
      ElMessage.error(msg);
    }
    return Promise.reject(new Error(msg));
  },
);

export const request = {
  get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return service.get(url, bindSession(config)) as unknown as Promise<T>;
  },
  post<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return service.post(url, data, bindSession(config)) as unknown as Promise<T>;
  },
  put<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return service.put(url, data, bindSession(config)) as unknown as Promise<T>;
  },
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return service.delete(url, bindSession(config)) as unknown as Promise<T>;
  },
  download(url: string, config?: AxiosRequestConfig): Promise<Blob> {
    return service.get(url, bindSession({
      timeout: 120_000,
      ...config,
      responseType: 'blob',
    })) as unknown as Promise<Blob>;
  },
  upload<T = any>(
    url: string,
    formData: FormData,
    onUploadProgress?: (e: AxiosProgressEvent) => void,
  ): Promise<T> {
    return service.post(url, formData, bindSession({
      timeout: 120_000,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    })) as unknown as Promise<T>;
  },
};

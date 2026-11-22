/**
 * Axios 请求封装：统一 Bearer 鉴权、401 单飞刷新令牌队列、CommonResult 解包、Blob 错误解析与文件下载。
 */
import axios, {
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

let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function flushRefreshQueue(newToken: string | null): void {
  const pending = refreshQueue;
  refreshQueue = [];
  for (const resolve of pending) {
    resolve(newToken);
  }
}

async function performRefreshToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    return null;
  }
  try {
    const resp = await rawHttp.post<
      CommonResult<{
        accessToken: string;
        refreshToken: string;
        passwordChangeRequired?: boolean;
      }>
    >('/system/auth/refresh-token', { refreshToken });
    const body = resp.data;
    if (body?.code === 0 && body.data?.accessToken) {
      setTokens(
        body.data.accessToken,
        body.data.refreshToken || refreshToken,
        body.data.passwordChangeRequired,
      );
      return body.data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

function redirectToLogin(): void {
  clearTokens();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const loginUrl = `${base}/login`;
  if (!window.location.pathname.endsWith('/login')) {
    const redirect = encodeURIComponent(
      window.location.pathname.replace(base, '') + window.location.search,
    );
    window.location.replace(`${loginUrl}?redirect=${redirect}`);
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
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

async function handleUnauthorized(
  originalConfig: RetryableRequestConfig,
): Promise<AxiosResponse> {
  if (originalConfig._retried) {
    redirectToLogin();
    return Promise.reject(new Error('登录状态已过期，请重新登录'));
  }
  originalConfig._retried = true;

  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      refreshQueue.push((newToken) => {
        if (!newToken) {
          reject(new Error('登录状态已过期，请重新登录'));
          return;
        }
        originalConfig.headers.Authorization = `Bearer ${newToken}`;
        resolve(service(originalConfig));
      });
    });
  }

  isRefreshing = true;
  try {
    const newToken = await performRefreshToken();
    flushRefreshQueue(newToken);
    if (!newToken) {
      redirectToLogin();
      return Promise.reject(new Error('登录状态已过期，请重新登录'));
    }
    originalConfig.headers.Authorization = `Bearer ${newToken}`;
    return service(originalConfig);
  } finally {
    isRefreshing = false;
  }
}

service.interceptors.response.use(
  async (response: AxiosResponse) => {
    const config = response.config as RetryableRequestConfig;
    if (config.responseType === 'blob') {
      const jsonErr = await unwrapBlobJsonError(response);
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
    const config = error.config as RetryableRequestConfig | undefined;
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
    return service.get(url, config) as unknown as Promise<T>;
  },
  post<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return service.post(url, data, config) as unknown as Promise<T>;
  },
  put<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return service.put(url, data, config) as unknown as Promise<T>;
  },
  delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return service.delete(url, config) as unknown as Promise<T>;
  },
  download(url: string, config?: AxiosRequestConfig): Promise<Blob> {
    return service.get(url, {
      timeout: 120_000,
      ...config,
      responseType: 'blob',
    }) as unknown as Promise<Blob>;
  },
  upload<T = any>(
    url: string,
    formData: FormData,
    onUploadProgress?: (e: AxiosProgressEvent) => void,
  ): Promise<T> {
    return service.post(url, formData, {
      timeout: 120_000,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress,
    }) as unknown as Promise<T>;
  },
};

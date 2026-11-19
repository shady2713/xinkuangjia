/**
 * 管理端统一 HTTP 请求客户端组装模块，负责 Bearer 鉴权、报文加解密、无感刷新与异常提示。
 *
 * @author shady2713
 */
import type {
  InternalAxiosRequestConfig,
  RequestClientOptions,
  RequestResponse,
} from '@vben/request';

import { getApiEncryptEnvConfig, useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  authenticateResponseInterceptor,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  RequestClient,
} from '@vben/request';
import { useAccessStore } from '@vben/stores';
import { createApiEncrypt, logError, logWarn } from '@vben/utils';

import { useAuthStore } from '#/store';
import { normalizeErrorMessage, showErrorMessage } from '#/utils/feedback';

import { refreshTokenApi } from './core';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
const apiEncrypt = createApiEncrypt(
  getApiEncryptEnvConfig(import.meta.env, import.meta.env.PROD),
);

/**
 * 创建带统一鉴权、传输加解密与错误提示的管理端请求客户端。
 *
 * @param baseURL 接口基础路径
 * @param options 请求客户端扩展选项
 * @returns 配置完成的 RequestClient 实例
 */
function createRequestClient(baseURL: string, options?: RequestClientOptions) {
  const client = new RequestClient({
    ...options,
    baseURL,
  });

  /** 会话失效后的统一重认证处理；跳转登出前保留当前令牌以便通知后端吊销。 */
  async function doReAuthenticate() {
    logWarn('Authentication expired');
    const accessStore = useAccessStore();
    const authStore = useAuthStore();
    if (
      preferences.app.loginExpiredMode === 'modal' &&
      accessStore.isAccessChecked
    ) {
      accessStore.setAccessToken(null);
      accessStore.setLoginExpired(true);
    } else {
      await authStore.logout();
    }
  }

  /**
   * 使用 refreshToken 换取新的 accessToken。
   *
   * @returns 刷新得到的最新访问令牌字符串
   * @throws 当本地缺少刷新令牌或服务端拒绝刷新时抛出异常
   */
  async function doRefreshToken() {
    const accessStore = useAccessStore();
    const refreshToken = accessStore.refreshToken as string;
    if (!refreshToken) {
      throw new Error('Refresh token is null!');
    }
    const resp = await refreshTokenApi(refreshToken);
    const newToken = resp?.data?.data?.accessToken;
    if (!newToken) {
      throw resp.data;
    }
    accessStore.setAccessToken(newToken);
    return newToken;
  }

  /**
   * 格式化 Bearer 认证头。
   *
   * @param token 访问令牌字符串
   * @returns Bearer 头文本或 null
   */
  function formatToken(token: null | string) {
    return token ? `Bearer ${token}` : null;
  }

  /**
   * 注入鉴权请求头与语言偏好，并对显式开启加密的首次请求执行报文加密。
   *
   * @param config Axios 内部请求配置
   * @returns 增强后的请求配置
   * @throws 请求体加密失败时抛出原始异常
   */
  async function handleRequestFulfilled(config: InternalAxiosRequestConfig) {
    const accessStore = useAccessStore();

    config.headers.Authorization = formatToken(accessStore.accessToken);
    config.headers['Accept-Language'] = preferences.app.locale;

    const encryptHeader = apiEncrypt.getEncryptHeader();
    const alreadyEncrypted =
      config.headers[encryptHeader] === 'true' ||
      config.headers[encryptHeader.toLowerCase()] === 'true';
    if ((config.headers || {}).isEncrypt && !alreadyEncrypted) {
      try {
        if (config.data) {
          config.data = apiEncrypt.encryptRequest(config.data);
          config.headers[encryptHeader] = 'true';
        }
      } catch (error) {
        logError('Request encryption failed', error);
        throw error;
      }
    }
    return config;
  }

  /**
   * 对携带加密响应头的字符串密文报文执行对称解密，并解包 HTTP 200 Blob 伪装的 JSON 业务错误，
   * 使 401 刷新令牌与全局错误提示拦截器能够统一生效。
   *
   * @param response Axios 原始响应对象
   * @returns 解密或原样透传后的响应对象
   * @throws 密文损坏、密钥不匹配或 Blob 载荷包含非零业务错误码时抛出异常
   */
  async function handleResponseDecrypt(response: RequestResponse) {
    if (response.data instanceof Blob) {
      const contentType = (response.data.type || '').toLowerCase();
      if (
        contentType.includes('application/json') ||
        contentType.includes('text/json') ||
        contentType.includes('problem+json')
      ) {
        const text = await response.data.text();
        try {
          const parsed = JSON.parse(text);
          if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.code === 'number' &&
            parsed.code !== 0
          ) {
            response.data = parsed;
            throw Object.assign(new Error(parsed.msg || '文件下载失败'), {
              data: parsed,
              response,
            });
          }
        } catch {
          // 非有效 JSON 负载时按普通二进制文件流继续向下透传。
        }
      }
      return response;
    }
    const encryptHeader = apiEncrypt.getEncryptHeader();
    const isEncryptResponse =
      response.headers[encryptHeader] === 'true' ||
      response.headers[encryptHeader.toLowerCase()] === 'true';
    if (isEncryptResponse && typeof response.data === 'string') {
      try {
        response.data = apiEncrypt.decryptResponse(response.data);
      } catch (error) {
        logError('Response decryption failed', error);
        throw new Error(`响应数据解密失败: ${(error as Error).message}`);
      }
    }
    return response;
  }

  client.addRequestInterceptor({
    fulfilled: handleRequestFulfilled,
  });

  client.addResponseInterceptor({
    fulfilled: handleResponseDecrypt,
  });

  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 0,
    }),
  );

  client.addResponseInterceptor(
    authenticateResponseInterceptor({
      client,
      doReAuthenticate,
      doRefreshToken,
      enableRefreshToken: preferences.app.enableRefreshToken,
      formatToken,
    }),
  );

  /**
   * 提取服务端标准错误文案并触发全局错误提示（跳过 401 重认证流程，并兼容 Blob 错误体）。
   *
   * @param msg 拦截器兜底错误文案
   * @param error Axios 错误对象
   */
  async function handleErrorMessage(msg: string, error: any) {
    if (
      error?.data?.code === 401 ||
      error?.response?.status === 401 ||
      error?.code === 401
    ) {
      return;
    }
    let responseData = error?.response?.data ?? error?.data ?? {};
    if (responseData instanceof Blob) {
      try {
        const parsed = JSON.parse(await responseData.text());
        if (parsed && typeof parsed === 'object') {
          responseData = parsed;
        }
      } catch {
        responseData = {};
      }
    }
    if (responseData?.code === 401) {
      return;
    }
    const errorMessage = normalizeErrorMessage(
      responseData?.error ?? responseData?.message ?? responseData?.msg ?? '',
    );
    showErrorMessage(errorMessage || msg);
  }

  client.addResponseInterceptor(
    errorMessageResponseInterceptor(handleErrorMessage),
  );

  return client;
}

/** 默认管理端业务请求客户端。 */
export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

/** 不带业务拦截器的基础请求客户端。 */
export const baseRequestClient = new RequestClient({ baseURL: apiURL });

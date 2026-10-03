/**
 * 应用请求边界：按发起身份绑定凭据、拒绝迟到结果并处理认证刷新。
 */
import type { RequestClientOptions } from '@vben/request';

import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import {
  authenticateResponseInterceptor,
  defaultResponseInterceptor,
  errorMessageResponseInterceptor,
  getErrorResponse,
  getErrorSession,
  isRecord,
  RequestClient,
  requireResponse,
} from '@vben/request';
import { useAccessStore } from '@vben/stores';
import { createApiEncrypt, logError, logWarn } from '@vben/utils';

import { useAuthStore } from '#/store';
import { assertCurrentSession, getSessionEpoch } from '#/utils/auth-session';
import { normalizeErrorMessage, showErrorMessage } from '#/utils/feedback';

import { refreshTokenApi } from './core';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
const apiEncrypt = createApiEncrypt(import.meta.env);

/** 创建携带当前身份的业务客户端，与无自动认证的登录辅助客户端分离。
 * @param baseURL 服务接口根地址。
 * @param options 业务响应格式和 Axios 配置。
 * @returns 已安装身份、加解密、错误处理拦截器的客户端。
 */
function createRequestClient(baseURL: string, options?: RequestClientOptions) {
  const client = new RequestClient({
    ...options,
    baseURL,
    getSessionEpoch,
  });

  /**
   * 当前身份失效时统一退出；旧请求不得清除后续登录的凭据。
   * @param epoch 触发未授权响应的请求所属会话。
   */
  async function doReAuthenticate(epoch: number) {
    assertCurrentSession(epoch);
    logWarn('Authentication expired');
    const authStore = useAuthStore();
    await authStore.logout();
  }

  /**
   * 使用本身份的刷新令牌续期，写回前再次校验身份。
   * @param epoch 发起刷新的会话代次。
   * @returns 新的访问令牌。
   * @throws {Error} 刷新令牌缺失、服务端拒绝或会话已改变。
   */
  async function doRefreshToken(epoch: number) {
    assertCurrentSession(epoch);
    const accessStore = useAccessStore();
    const refreshToken = accessStore.refreshToken;
    if (!refreshToken) {
      throw new Error('Refresh token is null!');
    }
    const result = await refreshTokenApi(refreshToken);
    assertCurrentSession(epoch);
    accessStore.setAccessToken(result.accessToken);
    accessStore.setRefreshToken(result.refreshToken);
    return result.accessToken;
  }

  /** 将存在的令牌编码为 Bearer 头，匿名请求不发送认证值。 */
  function formatToken(token: null | string) {
    return token ? `Bearer ${token}` : null;
  }

  // 请求头处理
  client.addRequestInterceptor({
    /** 只为仍有效的发起身份附加凭据，并按请求约定加密。
     * @param config 已在同步请求入口绑定身份的请求配置。
     * @returns 完成凭据、语言及可选加密处理的请求配置。
     * @throws {Error} 身份失效或请求加密失败时停止发送。
     */
    fulfilled: (config) => {
      assertCurrentSession(config.sessionEpoch ?? getSessionEpoch());
      const accessStore = useAccessStore();

      config.headers.Authorization = formatToken(accessStore.accessToken);
      config.headers['Accept-Language'] = preferences.app.locale;

      // 是否 API 加密
      if ((config.headers || {}).isEncrypt) {
        try {
          // 加密请求数据
          if (config.data) {
            config.data = apiEncrypt.encryptRequest(config.data);
            // 设置加密标识头
            config.headers[apiEncrypt.getEncryptHeader()] = 'true';
          }
        } catch (error) {
          logError('Request encryption failed', error);
          throw error;
        }
      }
      return config;
    },
  });

  // API 解密响应拦截器
  client.addResponseInterceptor({
    /** 在业务读取响应之前阻断旧身份结果，并解密服务端声明的密文。
     * @param value 包含原请求身份及响应头的未知传输层结果。
     * @returns 属于当前身份的明文响应。
     * @throws {Error} 身份已结束或密文无法解码时拒绝响应。
     */
    fulfilled: (value) => {
      const response = requireResponse(value);
      assertCurrentSession(response.config.sessionEpoch ?? getSessionEpoch());
      // 检查是否需要解密响应数据
      const encryptHeader = apiEncrypt.getEncryptHeader();
      const isEncryptResponse =
        response.headers[encryptHeader] === 'true' ||
        response.headers[encryptHeader.toLowerCase()] === 'true';
      if (isEncryptResponse && typeof response.data === 'string') {
        try {
          // 解密响应数据
          response.data = apiEncrypt.decryptResponse(response.data);
        } catch (error) {
          logError('Response decryption failed', error);
          throw new Error('响应数据解密失败', { cause: error });
        }
      }
      return response;
    },
    /** 先拒绝旧身份错误，避免后续认证拦截器注销新账号。 */
    rejected: (error) => {
      const epoch = getErrorSession(error);
      if (epoch !== undefined) {
        assertCurrentSession(epoch);
      }
      throw error;
    },
  });

  // 处理返回的响应数据格式
  client.addResponseInterceptor(
    defaultResponseInterceptor({
      codeField: 'code',
      dataField: 'data',
      successCode: 0,
    }),
  );

  // token过期的处理
  client.addResponseInterceptor(
    authenticateResponseInterceptor({
      client,
      doReAuthenticate,
      doRefreshToken,
      enableRefreshToken: preferences.app.enableRefreshToken,
      formatToken,
      getSessionEpoch,
    }),
  );

  // 通用的错误处理,如果没有进入上面的错误处理逻辑，就会进入这里
  client.addResponseInterceptor(
    errorMessageResponseInterceptor(
      /** 提取服务端文案，同时避免未授权退出的重复提示。
       * @param msg 按状态码选择的默认提示。
       * @param error 尚未验证结构的请求失败。
       */ (msg: string, error) => {
        // 这里可以根据业务进行定制,你可以拿到 error 内的信息进行定制化处理，根据不同的 code 做不同的提示，而不是直接使用 message.error 提示 msg
        // 当前mock接口返回的错误字段是 error 或者 message
        const response = getErrorResponse(error);
        const responseData = isRecord(response?.data) ? response.data : {};
        const message =
          responseData.error ?? responseData.message ?? responseData.msg;
        const errorMessage = normalizeErrorMessage(
          typeof message === 'string' ? message : '',
        );
        // 特殊处理：避免 401 “账号未登录” 重复提示。因为此时会跳转到登录界面，只需提示一次。
        if (responseData.code === 401) {
          return;
        }
        // 如果没有错误信息，则会根据状态码进行提示
        showErrorMessage(errorMessage || msg);
      },
    ),
  );

  return client;
}

export const requestClient = createRequestClient(apiURL, {
  responseReturn: 'data',
});

/** 无自动认证及重试的客户端，仅供显式凭据或公开认证辅助接口使用。 */
export const baseRequestClient = new RequestClient({ baseURL: apiURL });

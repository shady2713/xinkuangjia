import type { RequestClient } from './request-client';
import type { MakeErrorMessageFn, ResponseInterceptorConfig } from './types';

import { $t } from '@vben/locales';
import { isFunction, logError } from '@vben/utils';

import axios from 'axios';

export const defaultResponseInterceptor = ({
  codeField = 'code',
  dataField = 'data',
  successCode = 0,
}: {
  /** 响应数据中代表访问结果的字段名 */
  codeField: string;
  /** 响应数据中装载实际数据的字段名，或者提供一个函数从响应数据中解析需要返回的数据 */
  dataField: ((response: any) => any) | string;
  /** 当codeField所指定的字段值与successCode相同时，代表接口访问成功。如果提供一个函数，则返回true代表接口访问成功 */
  successCode: ((code: any) => boolean) | number | string;
}): ResponseInterceptorConfig => {
  return {
    fulfilled: (response) => {
      const { config, data: responseData, status } = response;

      if (config.responseReturn === 'raw') {
        return response;
      }

      if (status >= 200 && status < 400) {
        if (config.responseReturn === 'body') {
          return responseData;
        } else if (
          isFunction(successCode)
            ? successCode(responseData[codeField])
            : responseData[codeField] === successCode
        ) {
          return isFunction(dataField)
            ? dataField(responseData)
            : responseData[dataField];
        }
      }
      throw Object.assign({}, response, { response });
    },
  };
};

/** Promise 成功解决回调签名。 */
type AnyResolve = (value: unknown) => void;

/** Promise 失败拒绝回调签名。 */
type AnyReject = (reason?: unknown) => void;

/**
 * 创建 401 令牌刷新与单飞队列重放响应拦截器。
 *
 * @param options 认证拦截器配置对象
 * @param options.client 请求客户端实例
 * @param options.doReAuthenticate 刷新失败或未启用刷新时的重认证回调
 * @param options.doRefreshToken 刷新访问令牌的异步回调
 * @param options.enableRefreshToken 是否启用无感刷新令牌
 * @param options.formatToken 授权头格式化函数
 * @returns 响应异常拦截器配置
 */
export const authenticateResponseInterceptor = ({
  client,
  doReAuthenticate,
  doRefreshToken,
  enableRefreshToken,
  formatToken,
}: {
  client: RequestClient;
  doReAuthenticate: () => Promise<void>;
  doRefreshToken: () => Promise<string>;
  enableRefreshToken: boolean;
  formatToken: (token: string) => null | string;
}): ResponseInterceptorConfig => {
  /**
   * 拦截 401 响应，协调单飞刷新令牌并重放或拒绝挂起队列。
   *
   * @param error Axios 响应错误对象
   * @returns 刷新成功后重放请求的响应结果
   * @throws 非 401 错误、禁用刷新或刷新失败时抛出对应异常
   */
  async function handleAuthRejected(error: any) {
    const { config, response, data: responseData } = error;
    if (response?.status !== 401 && responseData?.code !== 401) {
      throw error;
    }
    if (!enableRefreshToken || config.__isRetryRequest) {
      await doReAuthenticate();
      throw error;
    }
    if (client.isRefreshing) {
      /**
       * 将并发 401 请求挂入等待队列，待刷新结束后统一结算。
       *
       * @param resolve Promise 成功回调
       * @param reject Promise 失败回调
       */
      function enqueuePendingRequest(resolve: AnyResolve, reject: AnyReject) {
        /**
         * 接收刷新结果并执行重放或直接拒绝。
         *
         * @param newToken 刷新得到的新访问令牌
         * @param refreshError 刷新失败时的异常对象
         */
        function settleQueuedRequest(newToken: string, refreshError?: unknown) {
          if (refreshError || !newToken) {
            reject(refreshError ?? error);
            return;
          }
          config.__isRetryRequest = true;
          config.headers.Authorization = formatToken(newToken);
          resolve(client.request(config.url, { ...config }));
        }
        client.refreshTokenQueue.push(settleQueuedRequest);
      }
      return new Promise(enqueuePendingRequest);
    }

    client.isRefreshing = true;
    config.__isRetryRequest = true;

    try {
      const newToken = await doRefreshToken();

      const queuedCallbacks = [...client.refreshTokenQueue];
      client.refreshTokenQueue = [];
      for (const callback of queuedCallbacks) {
        callback(newToken);
      }

      config.headers = config.headers || {};
      config.headers.Authorization = formatToken(newToken);
      return client.request(error.config.url, { ...error.config });
    } catch (refreshError) {
      const queuedCallbacks = [...client.refreshTokenQueue];
      client.refreshTokenQueue = [];
      for (const callback of queuedCallbacks) {
        callback('', refreshError);
      }
      logError('request:refresh-token', refreshError);
      await doReAuthenticate();

      throw refreshError;
    } finally {
      client.isRefreshing = false;
    }
  }

  return {
    rejected: handleAuthRejected,
  };
};

export const errorMessageResponseInterceptor = (
  makeErrorMessage?: MakeErrorMessageFn,
): ResponseInterceptorConfig => {
  return {
    rejected: (error: any) => {
      if (axios.isCancel(error)) {
        return Promise.reject(error);
      }

      const err: string = error?.toString?.() ?? '';
      let errMsg = '';
      if (err?.includes('Network Error')) {
        errMsg = $t('ui.fallback.http.networkError');
      } else if (error?.message?.includes?.('timeout')) {
        errMsg = $t('ui.fallback.http.requestTimeout');
      }
      if (errMsg) {
        makeErrorMessage?.(errMsg, error);
        return Promise.reject(error);
      }

      let errorMessage = '';
      const status =
        error?.code || error?.response?.data?.code || error?.response?.status;

      switch (status) {
        case 400: {
          errorMessage = $t('ui.fallback.http.badRequest');
          break;
        }
        case 401: {
          errorMessage = $t('ui.fallback.http.unauthorized');
          break;
        }
        case 403: {
          errorMessage = $t('ui.fallback.http.forbidden');
          break;
        }
        case 404: {
          errorMessage = $t('ui.fallback.http.notFound');
          break;
        }
        case 408: {
          errorMessage = $t('ui.fallback.http.requestTimeout');
          break;
        }
        default: {
          errorMessage = $t('ui.fallback.http.internalServerError');
        }
      }
      makeErrorMessage?.(errorMessage, error);
      return Promise.reject(error);
    },
  };
};

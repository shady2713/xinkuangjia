/** 标准业务解包、按会话合并刷新及未知错误的安全展示。 */
import type { RequestClient } from './request-client';
import type { MakeErrorMessageFn, ResponseInterceptorConfig } from './types';

import { $t } from '@vben/locales';
import { logError } from '@vben/utils';

import axios from 'axios';

import { getErrorResponse, isRecord, requireResponse } from './response';

/** 从已确认的业务对象选择具体数据，选择结果仍由 API 验证。 */
type DataSelector = (response: Record<string, unknown>) => unknown;

/** 判断未知业务码是否属于成功结果。 */
type SuccessPredicate = (code: unknown) => boolean;

/** 按明确的响应模式检查并解包业务外壳。
 * @param options 业务码字段、数据选择器与成功判定。
 * @param options.codeField 业务响应码所在字段。
 * @param options.dataField 业务数据所在字段或数据选择器。
 * @param options.successCode 成功业务码或成功判定函数。
 * @returns 保持未知数据边界的成功响应处理器。
 */
export const defaultResponseInterceptor = ({
  codeField = 'code',
  dataField = 'data',
  successCode = 0,
}: {
  /** 响应数据中代表访问结果的字段名 */
  codeField: string;
  /** 响应数据中装载实际数据的字段名，或者提供一个函数从响应数据中解析需要返回的数据 */
  dataField: DataSelector | string;
  /** 当codeField所指定的字段值与successCode相同时，代表接口访问成功。如果提供一个函数，则返回true代表接口访问成功 */
  successCode: number | string | SuccessPredicate;
}): ResponseInterceptorConfig => {
  return {
    /** 先验证传输外壳，data 模式另外要求业务 JSON 对象。
     * @param value 上一处理器返回的未知值。
     * @returns 所选模式下的传输响应、响应体或业务数据。
     * @throws {unknown} 外壳或业务码无效时保留完整响应供错误链处理。
     */
    fulfilled: (value) => {
      const response = requireResponse(value);
      const { config, data: responseData, status } = response;

      if (config.responseReturn === 'raw') {
        return response;
      }

      if (status >= 200 && status < 400) {
        if (config.responseReturn === 'body') {
          return responseData;
        } else if (
          isRecord(responseData) &&
          (typeof successCode === 'function'
            ? successCode(responseData[codeField])
            : responseData[codeField] === successCode)
        ) {
          return typeof dataField === 'function'
            ? dataField(responseData)
            : responseData[dataField];
        }
      }
      throw Object.assign({}, response, { response });
    },
  };
};

/**
 * 将同一身份的未授权请求合并为一次刷新，所有等待者共享成功或失败结果。
 * @param options 请求客户端、刷新和失效处理；提供身份读取器时拒绝旧身份重试。
 * @param options.client 用于执行原请求重试的客户端。
 * @param options.doReAuthenticate 结束指定身份的处理函数。
 * @param options.doRefreshToken 返回指定身份新令牌的刷新函数。
 * @param options.enableRefreshToken 是否允许一次刷新重试。
 * @param options.formatToken 将新令牌编码为认证头。
 * @param options.getSessionEpoch 返回当前登录身份代次。
 * @returns 认证错误拦截器；刷新失败直接拒绝等待请求，不以空令牌重新发送。
 */
export const authenticateResponseInterceptor = ({
  client,
  doReAuthenticate,
  doRefreshToken,
  enableRefreshToken,
  formatToken,
  getSessionEpoch = /** 未配置身份隔离的通用客户端使用单一刷新作用域。 */ () =>
    0,
}: {
  client: RequestClient;
  /** 结束指定身份，调用方必须确认该身份仍然有效。 */
  doReAuthenticate: (epoch: number) => Promise<void>;
  /** 获取指定身份的新令牌，不得写入其他身份。 */
  doRefreshToken: (epoch: number) => Promise<string>;
  enableRefreshToken: boolean;
  /** 将刷新结果编码为 Authorization 头。 */
  formatToken: (token: string) => null | string;
  /** 返回当前身份代次，切换身份时应单调变化。 */
  getSessionEpoch?: () => number;
}): ResponseInterceptorConfig => {
  const refreshes = new Map<number, Promise<string>>();

  /** 拒绝已经被其他身份替换的请求，保留 Axios 取消语义。 */
  function assertSession(epoch: number): void {
    if (epoch !== getSessionEpoch()) {
      throw new axios.CanceledError('登录会话已变更，已取消旧会话请求');
    }
  }

  return {
    /** 处理未授权请求，同一身份合并刷新，失败直接拒绝所有等待者。
     * @param error 保留原请求配置的传输或业务未授权错误。
     * @returns 刷新后且身份仍有效时的重试结果。
     * @throws {Error} 非认证错误、刷新失败、重复未授权或身份失效时拒绝。
     */
    rejected: async (error) => {
      const response = getErrorResponse(error);
      if (
        !response ||
        (response.status !== 401 &&
          (!isRecord(response.data) || response.data.code !== 401))
      ) {
        throw error;
      }
      const { config } = response;
      if (typeof config.url !== 'string') throw error;
      const epoch = config.sessionEpoch ?? getSessionEpoch();
      assertSession(epoch);
      if (!enableRefreshToken || config.__isRetryRequest) {
        await doReAuthenticate(epoch);
        throw error;
      }
      config.__isRetryRequest = true;
      let refresh = refreshes.get(epoch);
      if (!refresh) {
        // 延迟到微任务执行，先登记共享 Promise；同步抛错也走同一失败分支。
        refresh = Promise.resolve()
          .then(
            /** 在刷新发出前再次检查身份，防止排入微任务后发生登录切换。 */ () => {
              assertSession(epoch);
              return doRefreshToken(epoch);
            },
          )
          .catch(
            /** 同一刷新仅退出一次，已结束身份的失败不触碰新身份。 */ async (
              refreshError: unknown,
            ) => {
              if (epoch === getSessionEpoch()) {
                logError('request:refresh-token', refreshError);
                await doReAuthenticate(epoch);
              }
              throw refreshError;
            },
          )
          .finally(
            /** 释放本身份的刷新所有权，不影响其他身份并行刷新。 */ () =>
              refreshes.delete(epoch),
          );
        refreshes.set(epoch, refresh);
      }
      const newToken = await refresh;
      assertSession(epoch);
      config.headers.Authorization = formatToken(newToken);
      return client.request(config.url, { ...config });
    },
  };
};

/** 只读取经过收窄的错误字段，为取消以外的失败选择稳定提示文案。
 * @param makeErrorMessage 将文案交给应用提示渠道的处理器。
 * @returns 保留原错误拒绝语义的响应拦截器。
 */
export const errorMessageResponseInterceptor = (
  makeErrorMessage?: MakeErrorMessageFn,
): ResponseInterceptorConfig => {
  return {
    /** 普通异常、HTTP 错误与取消分别处理，未知值不执行自定义字符串转换。
     * @param error 未知的传输或业务失败。
     * @returns 拒绝原失败的 Promise，不转换为成功数据。
     */
    rejected: (error: unknown) => {
      if (axios.isCancel(error)) {
        return Promise.reject(error);
      }

      const err =
        isRecord(error) && typeof error.message === 'string'
          ? error.message
          : '';
      let errMsg = '';
      if (err?.includes('Network Error')) {
        errMsg = $t('ui.fallback.http.networkError');
      } else if (err.includes('timeout')) {
        errMsg = $t('ui.fallback.http.requestTimeout');
      }
      if (errMsg) {
        makeErrorMessage?.(errMsg, error);
        return Promise.reject(error);
      }

      let errorMessage = '';
      const response = getErrorResponse(error);
      const status =
        isRecord(response?.data) && typeof response.data.code === 'number'
          ? response.data.code
          : response?.status;

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

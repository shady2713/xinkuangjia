/** 传输层边界检查：HTTP 外壳与业务 JSON 分开收窄。 */
import type { RequestResponse } from './types';

import { AxiosHeaders } from 'axios';

/** 判断可按字段读取的非空对象，不把数组当作响应外壳。
 * @param value 未知传输或错误值。
 * @returns 是否可按字符串键安全访问字段。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 验证 Axios 在请求链内创建的响应外壳，业务 data 保留 unknown。
 * @param value 上一个响应处理器的输出。
 * @returns 确认包含状态、响应头及 Axios 请求配置的传输结果。
 * @throws {TypeError} 前一处理器已解包或返回无效 HTTP 外壳。
 */
export function requireResponse(value: unknown): RequestResponse {
  if (!isResponse(value)) throw new TypeError('响应处理器需要完整 HTTP 响应');
  return value;
}

/** 从未知失败中读取经过外壳校验的 HTTP 响应；普通异常没有响应。
 * @param error 请求链抛出的未知失败。
 * @returns 有效传输响应，普通异常或无效外壳返回 undefined。
 */
export function getErrorResponse(error: unknown): RequestResponse | undefined {
  return isRecord(error) && isResponse(error.response)
    ? error.response
    : undefined;
}

/** 读取失败请求绑定的会话代次；缺失或无效值不能充当当前身份。
 * @param error 请求链抛出的未知失败。
 * @returns 已验证的请求代次，缺失或无效字段返回 undefined。
 */
export function getErrorSession(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.config)) return undefined;
  const epoch = error.config.sessionEpoch;
  return typeof epoch === 'number' && Number.isSafeInteger(epoch)
    ? epoch
    : undefined;
}

/** 判断响应外壳及本地 Axios 配置，不能据此承诺任何业务数据结构。 */
function isResponse(value: unknown): value is RequestResponse {
  if (!isRecord(value) || !isRecord(value.config)) return false;
  const config = value.config;
  return (
    typeof value.status === 'number' &&
    (value.statusText === undefined || typeof value.statusText === 'string') &&
    isRecord(value.headers) &&
    config.headers instanceof AxiosHeaders &&
    (config.url === undefined || typeof config.url === 'string') &&
    (config.sessionEpoch === undefined ||
      (typeof config.sessionEpoch === 'number' &&
        Number.isSafeInteger(config.sessionEpoch))) &&
    (config.__isRetryRequest === undefined ||
      typeof config.__isRetryRequest === 'boolean') &&
    (config.responseReturn === undefined ||
      config.responseReturn === 'raw' ||
      config.responseReturn === 'body' ||
      config.responseReturn === 'data')
  );
}

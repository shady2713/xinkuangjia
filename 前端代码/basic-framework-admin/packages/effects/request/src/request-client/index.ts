/**
 * 请求客户端出口：聚合 createRequestClient 等客户端构造能力与默认拦截器预设，
 * 以及 getErrorResponse、getErrorSession、isRecord、requireResponse
 * 等响应断言工具和相关类型。
 */
export * from './preset-interceptors';
export * from './request-client';
export {
  getErrorResponse,
  getErrorSession,
  isRecord,
  requireResponse,
} from './response';
export type * from './types';

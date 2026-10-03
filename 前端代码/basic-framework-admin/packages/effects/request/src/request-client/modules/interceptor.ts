/** 请求处理器交给 Axios；响应转换独立保留真实 unknown 输入和输出契约。 */
import type { AxiosInstance } from 'axios';

import type {
  RequestInterceptorConfig,
  ResponseInterceptorConfig,
} from '../types';

/** 管理有序处理链，避免将解包后的业务值声明成 AxiosResponse。 */
class InterceptorManager {
  private axiosInstance: AxiosInstance;
  private responses: ResponseInterceptorConfig[] = [];

  /** 绑定传输实例；响应转换留在显式处理链中。
   * @param instance 负责实际发送请求的 Axios 实例。
   */
  constructor(instance: AxiosInstance) {
    this.axiosInstance = instance;
  }

  /** 注册发送前的配置转换或失败处理。
   * @param options 只允许返回 Axios 配置的请求处理器。
   * @param options.fulfilled 成功时检查或转换请求配置。
   * @param options.rejected 失败时继续拒绝请求。
   */
  addRequestInterceptor({
    fulfilled,
    rejected,
  }: RequestInterceptorConfig = {}) {
    this.axiosInstance.interceptors.request.use(fulfilled, rejected);
  }

  /** 注册响应成功及失败转换，按注册顺序执行。
   * @param interceptor 输入和输出均需由处理器按实际契约收窄的转换。
   */
  addResponseInterceptor(interceptor: ResponseInterceptorConfig = {}) {
    this.responses.push(interceptor);
  }

  /** 将传输 Promise 依次交给响应处理器，不伪造中间数据类型。
   * @param response Axios 传输或前一层错误所形成的结果。
   * @returns 所有处理器执行后的最终值。
   */
  processResponse(response: Promise<unknown>): Promise<unknown> {
    let result = response;
    for (const { fulfilled, rejected } of this.responses) {
      result = result.then(fulfilled, rejected);
    }
    return result;
  }
}

export { InterceptorManager };

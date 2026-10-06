/** 基于 Axios 传输及显式响应转换的客户端；未声明响应模型的调用返回 unknown。 */
import type { AxiosInstance, AxiosResponse } from 'axios';

import type { RequestClientConfig, RequestClientOptions } from './types';

import { bindMethods, isString, merge } from '@vben/utils';

import axios from 'axios';
import qs from 'qs';

import { FileDownloader } from './modules/downloader';
import { InterceptorManager } from './modules/interceptor';
import { SSE } from './modules/sse';
import { FileUploader } from './modules/uploader';
import { getErrorResponse, isRecord } from './response';

/** 将支持的数组参数编码映射到 qs，不访问未知参数对象内部字段。
 * @param paramsSerializer 预设编码名称或 Axios 自定义编码器。
 * @returns 对应编码函数，或原有自定义编码配置。
 */
function getParamsSerializer(
  paramsSerializer: RequestClientOptions['paramsSerializer'],
) {
  if (isString(paramsSerializer)) {
    switch (paramsSerializer) {
      case 'brackets': {
        return /** 使用方括号编码数组参数。 */ (params: unknown) =>
          qs.stringify(params, { arrayFormat: 'brackets' });
      }
      case 'comma': {
        return /** 使用逗号编码数组参数。 */ (params: unknown) =>
          qs.stringify(params, { arrayFormat: 'comma' });
      }
      case 'indices': {
        return /** 使用索引编码数组参数。 */ (params: unknown) =>
          qs.stringify(params, { arrayFormat: 'indices' });
      }
      case 'repeat': {
        return /** 使用重复键编码数组参数。 */ (params: unknown) =>
          qs.stringify(params, { arrayFormat: 'repeat' });
      }
    }
  }
  return paramsSerializer;
}

/** 统一请求身份捕获、传输配置、响应转换及附属流和文件能力。 */
class RequestClient {
  public addRequestInterceptor: InterceptorManager['addRequestInterceptor'];

  public addResponseInterceptor: InterceptorManager['addResponseInterceptor'];
  public download: FileDownloader['download'];

  public readonly instance: AxiosInstance;
  public postSSE: SSE['postSSE'];
  public requestSSE: SSE['requestSSE'];
  public upload: FileUploader['upload'];
  /** 同步读取调用身份，不将登录切换后的凭据绑定到旧请求。 */
  private readonly getSessionEpoch?: RequestClientOptions['getSessionEpoch'];
  private readonly interceptorManager: InterceptorManager;

  /**
   * 构造函数，用于创建Axios实例
   * @param options - Axios请求配置，可选
   */
  constructor(options: RequestClientOptions = {}) {
    // 合并默认配置和传入的配置
    const defaultConfig: RequestClientOptions = {
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
      },
      responseReturn: 'raw',
      // 默认超时时间
      timeout: 10_000,
      paramsSerializer: 'repeat',
    };
    const { getSessionEpoch, ...axiosConfig } = options;
    this.getSessionEpoch = getSessionEpoch;
    const requestConfig = merge(axiosConfig, defaultConfig);
    requestConfig.paramsSerializer = getParamsSerializer(
      requestConfig.paramsSerializer,
    );
    this.instance = axios.create(requestConfig);

    bindMethods(this);

    // 实例化拦截器管理器
    const interceptorManager = new InterceptorManager(this.instance);
    this.interceptorManager = interceptorManager;
    this.addRequestInterceptor =
      interceptorManager.addRequestInterceptor.bind(interceptorManager);
    this.addResponseInterceptor =
      interceptorManager.addResponseInterceptor.bind(interceptorManager);

    // 实例化文件上传器
    const fileUploader = new FileUploader(this);
    this.upload = fileUploader.upload.bind(fileUploader);
    // 实例化文件下载器
    const fileDownloader = new FileDownloader(this);
    this.download = fileDownloader.download.bind(fileDownloader);
    // 实例化SSE模块
    const sse = new SSE(this);
    this.postSSE = sse.postSSE.bind(sse);
    this.requestSSE = sse.requestSSE.bind(sse);
  }

  /** 验证长连接或重试仍归属于请求创建时的身份。
   * @param epoch 请求配置中同步捕获的代次，未启用身份隔离时可缺省。
   * @throws {CanceledError} 当前身份已替换该请求的原身份。
   */
  public assertRequestSession(epoch: number | undefined): void {
    if (
      epoch !== undefined &&
      this.getSessionEpoch &&
      epoch !== this.getSessionEpoch()
    ) {
      throw new axios.CanceledError('登录会话已变更，已取消旧会话请求');
    }
  }

  /**
   * 发送 DELETE 请求。
   * @param url 删除接口地址。
   * @param config 请求条件及传输配置。
   * @returns 经过响应处理链的数据，具体模型由调用方校验。
   */
  public delete<T = unknown>(
    url: string,
    config?: RequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, method: 'DELETE' });
  }

  /**
   * 发送 GET 请求。
   * @param url 查询接口地址。
   * @param config 查询参数及传输配置。
   * @returns 经过响应处理链的数据，具体模型由调用方校验。
   */
  public get<T = unknown>(
    url: string,
    config?: RequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, method: 'GET' });
  }

  /**
   * 获取基础URL
   * @returns 创建实例时配置的 baseURL；未配置时为 undefined，此时请求地址需自带协议与主机。
   */
  public getBaseUrl() {
    return this.instance.defaults.baseURL;
  }

  /**
   * 发送 POST 请求。
   * @param url 创建或动作接口地址。
   * @param data Axios 按 Content-Type 序列化的请求体。
   * @param config 请求头、身份及其他传输配置。
   * @returns 经过响应处理链的数据，具体模型由调用方校验。
   */
  public post<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, data, method: 'POST' });
  }

  /**
   * 发送 PUT 请求。
   * @param url 更新接口地址。
   * @param data Axios 按 Content-Type 序列化的请求体。
   * @param config 请求头、身份及其他传输配置。
   * @returns 经过响应处理链的数据，具体模型由调用方校验。
   */
  public put<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestClientConfig,
  ): Promise<T> {
    return this.request<T>(url, { ...config, data, method: 'PUT' });
  }

  /**
   * 按调用身份发送请求，保留重试的原身份并归一化传输错误。
   * @param url 相对于客户端根地址的接口路径。
   * @param config 请求参数和已捕获的重试身份。
   * @returns 经过响应拦截器处理的业务或原始响应。
   * @throws {Error} 传输、业务验证或身份取消失败时拒绝，不自动忽略错误。
   */
  public request<T = unknown>(
    url: string,
    config: RequestClientConfig,
  ): Promise<T>;
  /** 执行请求并保持转换过程为 unknown；泛型响应由具体 API 的运行时边界负责核实。
   * @param url 业务接口地址。
   * @param config 请求参数及可选身份代次。
   * @returns 响应处理链的实际结果，不强制断言成 AxiosResponse。
   * @throws {unknown} 传输或转换失败时拒绝服务端业务数据或原始错误。
   */
  public async request(
    url: string,
    config: RequestClientConfig,
  ): Promise<unknown> {
    // 在首个 await 前绑定调用身份；重试必须携带原代次。
    config = {
      ...config,
      sessionEpoch: config.sessionEpoch ?? this.getSessionEpoch?.(),
    };
    this.assertRequestSession(config.sessionEpoch);
    let transportResponse: AxiosResponse<unknown> | undefined;
    try {
      return await this.interceptorManager.processResponse(
        this.instance
          .request<unknown>({
            url,
            ...config,
            ...(config.paramsSerializer
              ? {
                  paramsSerializer: getParamsSerializer(
                    config.paramsSerializer,
                  ),
                }
              : {}),
          })
          .then(
            /** 保留原始传输结果，以便处理链拒绝时释放尚未交付的流。 */ (
              response,
            ) => {
              transportResponse = response;
              return response;
            },
          ),
      );
    } catch (error: unknown) {
      const response = getErrorResponse(error);
      const stream = transportResponse?.data ?? response?.data;
      if (stream instanceof ReadableStream && !stream.locked) {
        await stream
          .cancel()
          .catch(/** 资源清理失败不能覆盖原始请求异常。 */ () => undefined);
      }
      // 只解包标准业务失败；字节流、Blob 或空响应不能替代传输异常。
      throw isRecord(response?.data) && typeof response.data.code === 'number'
        ? response.data
        : error;
    }
  }
}

/**
 * 将表格排序条件转换为后端排序参数。
 * @param sorts 按优先级排列的字段和排序方向。
 * @returns 使用 sortingFields 索引键表达的查询参数，空条件返回空对象。
 */
export const buildSortingField = (
  sorts: ReadonlyArray<{ field: string; order: null | string }>,
) => {
  if (!sorts || sorts.length === 0) {
    return {};
  }
  const result: Record<string, null | string> = {};
  sorts.forEach(
    /** 保留字段顺序，以后端支持的索引参数表达排序。 */ (sort, index) => {
      result[`sortingFields[${index}].field`] = sort.field;
      result[`sortingFields[${index}].order`] = sort.order;
    },
  );
  return result;
};

export { RequestClient };

/** 请求入口、拦截器与分页模型的明确契约；未经校验的数据和错误保持 unknown。 */
import type {
  AxiosRequestConfig,
  AxiosResponse,
  CreateAxiosDefaults,
  InternalAxiosRequestConfig,
} from 'axios';

/** 与 Axios 配置共同传递的序列化、响应模式和身份控制选项。 */
type ExtendOptions<T = unknown> = {
  /** 同一请求最多刷新重试一次，排队请求也必须设置。 */
  __isRetryRequest?: boolean;
  /**
   * 参数序列化方式。预置的有
   * - brackets: ids[]=1&ids[]=2&ids[]=3
   * - comma: ids=1,2,3
   * - indices: ids[0]=1&ids[1]=2&ids[2]=3
   * - repeat: ids=1&ids=2&ids=3
   */
  paramsSerializer?:
    | 'brackets'
    | 'comma'
    | 'indices'
    | 'repeat'
    | AxiosRequestConfig<T>['paramsSerializer'];
  /**
   * 响应数据的返回方式。
   * - raw: 原始的AxiosResponse，包括headers、status等，不做是否成功请求的检查。
   * - body: 返回响应数据的BODY部分（只会根据status检查请求是否成功，忽略对code的判断，这种情况下应由调用方检查请求是否成功）。
   * - data: 解构响应的BODY数据，只返回其中的data节点数据（会检查status和code是否为成功状态）。
   */
  responseReturn?: 'body' | 'data' | 'raw';
  /** 请求创建时的身份代次；重试保留原值，不得借用后续登录凭据。 */
  sessionEpoch?: number;
};
/** 保持请求数据泛型的 Axios 配置及本框架扩展选项。 */
type RequestClientConfig<T = unknown> = AxiosRequestConfig<T> &
  ExtendOptions<T>;

/** 经过传输外壳校验的响应，业务数据默认仍为未知值。 */
type RequestResponse<T = unknown> = {
  config: ExtendOptions & InternalAxiosRequestConfig<unknown>;
  /** 某些传输适配器只提供数字状态，业务层不得要求状态描述文本存在。 */
  statusText?: string;
} & Omit<AxiosResponse<T, unknown>, 'config' | 'statusText'>;

/** 请求体可用的 Content-Type 取值：JSON、二进制流、URL 编码表单与文件上传表单。 */
type RequestContentType =
  | 'application/json;charset=utf-8'
  | 'application/octet-stream;charset=utf-8'
  | 'application/x-www-form-urlencoded;charset=utf-8'
  | 'multipart/form-data;charset=utf-8';

/** 客户端默认配置及同步身份读取器；读取器不传入 Axios 配置。 */
type RequestClientOptions = {
  /** 在 request 同步入口捕获身份，避免异步拦截器误绑定后续登录。 */
  getSessionEpoch?: () => number;
} & CreateAxiosDefaults<unknown> &
  ExtendOptions;

/**
 * SSE 请求选项
 */
interface SseRequestOptions extends RequestInit {
  /** 按传输分块交付文本；调用方负责 SSE 事件分帧。 */
  onMessage?: (message: string) => void;
  /** 在当前身份的流正常结束后通知，不在错误或取消时调用。 */
  onEnd?: () => void;
}

/** 请求拦截器只能返回请求配置，错误处理不能伪装成功配置。 */
interface RequestInterceptorConfig {
  /** 完成请求头、数据或身份检查，并返回可继续发送的配置。 */
  fulfilled?: (
    config: ExtendOptions & InternalAxiosRequestConfig<unknown>,
  ) =>
    | (ExtendOptions & InternalAxiosRequestConfig<unknown>)
    | Promise<ExtendOptions & InternalAxiosRequestConfig<unknown>>;
  /** 请求阶段失败时拒绝原错误，禁止用未知值恢复发送。 */
  rejected?: (error: unknown) => never | Promise<never>;
}

/** 响应转换可以解开 HTTP 外壳；每个后续转换都须明确校验其输入。 */
interface ResponseInterceptorConfig {
  /** 接收当前处理链结果并返回转换后的业务数据。 */
  fulfilled?: (response: unknown) => unknown;
  /** 处理未知失败，可显式恢复结果或继续拒绝。 */
  rejected?: (error: unknown) => unknown;
}

/** 展示已选择的错误文案，扩展方必须收窄原始错误再读取字段。 */
type MakeErrorMessageFn = (message: string, error: unknown) => void;

/** 标准业务响应外壳；数据模型由具体接口解析。 */
interface HttpResponse<T = unknown> {
  /**
   * 0 表示成功 其他表示失败
   * 0 means success, others means fail
   */
  code: number;
  data: T;
  msg: string;
}

/** 分页参数允许附加查询字段，但未知条件不得未经收窄直接读取。 */
interface PageParam {
  [key: string]: unknown;
  pageNo: number;
  pageSize: number;
}

/**
 * 分页查询结果外壳。
 * list 仅含当前页记录，total 是符合条件的总条数而非本页条数，分页控件需按 total 计算页数。
 */
interface PageResult<T> {
  list: T[];
  total: number;
}

export type {
  HttpResponse,
  MakeErrorMessageFn,
  PageParam,
  PageResult,
  RequestClientConfig,
  RequestClientOptions,
  RequestContentType,
  RequestInterceptorConfig,
  RequestResponse,
  ResponseInterceptorConfig,
  SseRequestOptions,
};

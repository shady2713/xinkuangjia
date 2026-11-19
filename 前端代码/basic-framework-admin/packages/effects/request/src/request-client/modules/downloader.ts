import type { RequestClient } from '../request-client';
import type { RequestClientConfig } from '../types';

/** 默认文件下载超时时间（120 秒，适配大批量 Excel 导出）。 */
const DEFAULT_DOWNLOAD_TIMEOUT = 120_000;

type DownloadRequestConfig = {
  /**
   * 定义期望获得的数据类型。
   * raw: 原始的AxiosResponse，包括headers、status等。
   * body: 只返回响应数据的BODY部分(Blob)
   */
  responseReturn?: 'body' | 'raw';
} & Omit<RequestClientConfig, 'responseReturn'>;

/**
 * 解析下载响应中伪装在 HTTP 200 Blob 里的后端 JSON 错误报文。
 *
 * @param blob 后端返回的 Blob 对象
 * @throws 当 Blob 内容为非零业务错误码的 JSON 对象时抛出错误
 */
async function throwIfJsonErrorBlob(blob: Blob): Promise<void> {
  const contentType = (blob.type || '').toLowerCase();
  if (
    !contentType.includes('application/json') &&
    !contentType.includes('text/json')
  ) {
    return;
  }
  const text = await blob.text();
  let parsed: undefined | { code?: number; msg?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.code === 'number' &&
    parsed.code !== 0
  ) {
    throw new Error(parsed.msg || `文件下载失败（错误码 ${parsed.code}）`);
  }
}

class FileDownloader {
  private client: RequestClient;

  constructor(client: RequestClient) {
    this.client = client;
  }

  /**
   * 下载文件，自动拦截 HTTP 200 返回的 JSON 业务错误报文，避免静默落盘损坏文件。
   *
   * @param url 文件的完整链接
   * @param config 配置信息，可选
   * @returns 当 responseReturn 为 body 时返回 Blob，否则返回完整响应
   * @throws Error 当请求客户端不支持指定 HTTP 方法，或服务端返回业务错误 JSON 时抛出异常
   */
  public async download<T = Blob>(
    url: string,
    config?: DownloadRequestConfig,
  ): Promise<T> {
    const finalConfig: DownloadRequestConfig = {
      timeout: DEFAULT_DOWNLOAD_TIMEOUT,
      responseReturn: 'body',
      method: 'GET',
      ...config,
      responseType: 'blob',
    };

    // Prefer a generic request if available; otherwise, dispatch to method-specific calls.
    const method = (finalConfig.method || 'GET').toUpperCase();
    const clientAny = this.client as any;
    let result: any;

    if (typeof clientAny.request === 'function') {
      result = await clientAny.request(url, finalConfig);
    } else {
      const lower = method.toLowerCase();
      if (typeof clientAny[lower] !== 'function') {
        throw new TypeError(
          `RequestClient does not support method "${method}". Please ensure the method is properly implemented in your RequestClient instance.`,
        );
      }
      if (['POST', 'PUT'].includes(method)) {
        const { data, ...rest } = finalConfig as Record<string, any>;
        result = await clientAny[lower](url, data, rest);
      } else {
        result = await clientAny[lower](url, finalConfig);
      }
    }

    let maybeBlob: Blob | undefined;
    if (result instanceof Blob) {
      maybeBlob = result;
    } else if (result?.data instanceof Blob) {
      maybeBlob = result.data;
    }
    if (maybeBlob) {
      await throwIfJsonErrorBlob(maybeBlob);
    }

    return result as T;
  }
}

export { FileDownloader };

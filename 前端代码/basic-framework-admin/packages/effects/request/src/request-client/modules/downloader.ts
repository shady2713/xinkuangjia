/** 下载始终通过真实 RequestClient，并在返回给保存工具前核实 Blob。 */
import type { RequestClient } from '../request-client';
import type { RequestClientConfig, RequestResponse } from '../types';

import { AxiosHeaders } from 'axios';

import { isRecord, requireResponse } from '../response';

/** 下载仅支持完整 HTTP 响应或已校验的 Blob。 */
type DownloadRequestConfig = Omit<RequestClientConfig, 'responseReturn'> & {
  responseReturn?: 'body' | 'raw';
};

/** 将各种 HTTP 下载方法统一到公开 request 入口，不兼容缺失方法的伪客户端。 */
class FileDownloader {
  private client: RequestClient;

  /** 复用请求身份及错误处理。
   * @param client 提供 request 方法的真实客户端。
   */
  constructor(client: RequestClient) {
    this.client = client;
  }

  /** 下载并保留状态和响应头。
   * @param url 下载接口。
   * @param config 明确要求 raw 结果的下载配置。
   * @returns 数据已验证为 Blob 的完整传输结果。
   */
  public download(
    url: string,
    config: DownloadRequestConfig & { responseReturn: 'raw' },
  ): Promise<RequestResponse<Blob>>;
  /** 下载可直接传给浏览器保存工具的文件。
   * @param url 下载接口。
   * @param config 下载方法、请求头或查询条件，默认返回 Blob。
   * @returns 已验证的文件二进制数据。
   */
  public download(
    url: string,
    config?: DownloadRequestConfig & { responseReturn?: 'body' },
  ): Promise<Blob>;
  /** 统一下载传输和边界验证。
   * @param url 下载接口。
   * @param config 可选传输配置。
   * @returns 根据 responseReturn 返回 Blob 或包含 Blob 的响应。
   * @throws {TypeError} 响应不是 Blob，拒绝将错误 JSON 当作文件保存。
   */
  public async download(
    url: string,
    config?: DownloadRequestConfig,
  ): Promise<Blob | RequestResponse<Blob>> {
    const response = requireResponse(
      await this.client.request<unknown>(url, {
        method: 'GET',
        ...config,
        responseType: 'blob',
        responseReturn: 'raw',
      }),
    );
    if (!(response.data instanceof Blob))
      throw new TypeError('下载响应不是 Blob');
    const contentType =
      response.headers instanceof AxiosHeaders
        ? response.headers.get('content-type')
        : (response.headers['content-type'] ??
          response.headers['Content-Type']);
    await rejectBusinessError(
      response.data,
      typeof contentType === 'string' ? contentType : response.data.type,
    );
    return config?.responseReturn === 'raw'
      ? { ...response, data: response.data }
      : response.data;
  }
}

/** 识别 Blob 传输模式下的标准业务失败，避免将权限错误 JSON 保存成导出文件。
 * @param blob 已经确认的二进制响应。
 * @param contentType 服务端声明的媒体类型。
 * @throws {Error} JSON 内容符合标准失败业务外壳时拒绝下载。
 */
async function rejectBusinessError(
  blob: Blob,
  contentType: string,
): Promise<void> {
  if (!contentType.toLowerCase().includes('application/json')) return;
  let value: unknown;
  try {
    value = JSON.parse(await blob.text());
  } catch {
    // 普通下载允许任意文件内容，只有明确的标准业务失败才按错误处理。
    return;
  }
  if (isRecord(value) && typeof value.code === 'number' && value.code !== 0) {
    throw new Error(typeof value.msg === 'string' ? value.msg : '下载请求失败');
  }
}

export { FileDownloader };

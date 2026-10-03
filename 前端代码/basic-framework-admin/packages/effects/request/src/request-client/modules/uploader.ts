/** 将明确可编码的表单值转换为 multipart，拒绝静默变为 object Object 的字段。 */
import type { RequestClient } from '../request-client';
import type { RequestClientConfig } from '../types';

/** 同时接受已声明 DTO 和含附加字段的字面量；附加字段在写入 FormData 前校验。 */
type UploadData = (Record<string, unknown> & { file: Blob }) | { file: Blob };

/** 为所属客户端提供带文件字段的 multipart 上传。 */
class FileUploader {
  private client: RequestClient;

  /** 复用客户端的认证、重试和响应处理。
   * @param client 负责 HTTP 发送的真实请求客户端。
   */
  constructor(client: RequestClient) {
    this.client = client;
  }

  /** 上传文件及调用者提供的附加表单字段。
   * @param url 文件上传接口。
   * @param data 含 file 的对象；附加字段只支持文本、数字、布尔、Blob 及这些值的数组。
   * @param data.file 待上传的二进制文件。
   * @param config 请求头、上传进度及身份等传输配置。
   * @returns 按客户端响应链处理的结果，具体 API 仍负责核实响应模型。
   * @throws {TypeError} file 不是 Blob，或附加字段无法无损编码为表单值。
   */
  public async upload<T = unknown>(
    url: string,
    data: UploadData,
    config?: RequestClientConfig,
  ): Promise<T> {
    if (!(data.file instanceof Blob))
      throw new TypeError('上传文件必须是 Blob');
    const formData = new FormData();
    const fields: Record<string, unknown> = { ...data };
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) {
        value.forEach(
          /** 数组采用后端支持的索引字段，不执行隐式对象字符串化。 */ (
            item: unknown,
            index,
          ) => appendValue(formData, `${key}[${index}]`, item),
        );
      } else appendValue(formData, key, value);
    }
    return this.client.post<T>(url, formData, {
      ...config,
      headers: { 'Content-Type': 'multipart/form-data', ...config?.headers },
    });
  }
}

/** 将可表示的单个值写入表单，null 和 undefined 表示未提供字段。
 * @param form 表单数据容器。
 * @param key 字段名或数组索引字段。
 * @param value 尚未验证的字段值。
 * @throws {TypeError} 字段为对象、函数或非有限数字，不能按表单协议表达。
 */
function appendValue(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (value instanceof Blob || typeof value === 'string')
    form.append(key, value);
  else if (
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    form.append(key, String(value));
  else throw new TypeError(`上传字段 ${key} 不是受支持的表单值`);
}

export { FileUploader };

/**
 * 上传组件的核心工具模块：统一处理不同后端上传接口返回值的解包、URL 提取和上传请求编排。
 * 上传接口返回值存在 AxiosResponse 包装、裸对象、纯字符串三种口径，这里负责收敛为统一形状。
 */
import type {
  UploadFile,
  UploadProgressEvent,
  UploadRequestOptions,
} from 'element-plus';

import type { FileUploadProps, UploadApiResult } from './typing';

import type { AxiosProgressEvent } from '#/api/core/file';

import { isFunction, isObject, isString } from '@vben/utils';

import { useUpload } from './use-upload';

/**
 * 解开 AxiosResponse 包装：含 data 字段的对象视为包装响应并取其 data，其余原样返回
 */
export function unwrapUploadResponse(response: unknown): unknown {
  if (isObject(response) && 'data' in (response as Record<string, unknown>)) {
    return (response as Record<string, unknown>).data;
  }
  return response;
}

/**
 * 从上传接口返回值中提取文件访问地址；依次尝试纯字符串、对象 url 字段、对象 data 字段，均不匹配时返回空字符串
 */
export function resolveUploadUrl(response: unknown): string {
  const value = unwrapUploadResponse(response);
  if (isString(value)) {
    return value;
  }
  if (isObject(value)) {
    const data = (value as Record<string, unknown>).data;
    const url = (value as Record<string, unknown>).url;
    if (isString(url)) {
      return url;
    }
    if (isString(data)) {
      return data;
    }
  }
  return '';
}

/**
 * 计算某个已上传文件对外暴露的值。
 * 配置了 resultField 时返回完整响应对象，由调用方自行按字段取值；否则依次回退为文件 URL、响应中的 URL、原始响应。
 */
export function resolveUploadValue(
  file: UploadFile,
  resultField?: string,
): unknown {
  const response = unwrapUploadResponse(file.response);
  if (resultField && response != null) {
    return response;
  }
  return file.url || resolveUploadUrl(response) || response;
}

/**
 * 执行实际上传：优先使用调用方传入的 api，未提供时回退到默认的文件上传接口；
 * 上传过程中把进度换算为百分比回调给 Element Plus；接口未返回结果时抛错，避免把 undefined 当成成功值。
 * @param props 上传配置，只需 api 与 directory 两项
 * @param options Element Plus 的上传请求上下文（文件、进度回调等）
 * @returns 上传接口的原始返回值
 * @throws 上传接口未返回结果时抛出 Error
 */
export async function requestUpload(
  props: Pick<FileUploadProps, 'api' | 'directory'>,
  options: UploadRequestOptions,
): Promise<UploadApiResult> {
  let { api } = props;
  if (!api || !isFunction(api)) {
    api = useUpload(props.directory).httpRequest;
  }
  const progressEvent: AxiosProgressEvent = (event) => {
    const total = event.total || 0;
    const percent = total > 0 ? Math.trunc((event.loaded / total) * 100) : 0;
    options.onProgress?.({
      percent,
      total,
      loaded: event.loaded || 0,
      lengthComputable: true,
    } as unknown as UploadProgressEvent);
  };
  const result = await api?.(options.file, progressEvent);
  if (result === undefined) {
    throw new Error('上传接口未返回结果');
  }
  return result;
}

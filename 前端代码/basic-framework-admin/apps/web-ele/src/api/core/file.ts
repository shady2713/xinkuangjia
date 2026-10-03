/**
 * 文件上传接口：供上传组件、AI 识别记录和头像裁剪等核心功能使用。
 * 核心上传组件通过此模块访问统一对象存储，文件管理页面的查询与删除接口仍由 infra/file 模块提供。
 */
import type { AxiosRequestConfig } from '@vben/request';

import { requestClient } from '#/api/request';

/** Axios 上传进度事件 */
export type AxiosProgressEvent = AxiosRequestConfig['onUploadProgress'];

/** 核心上传链路使用的文件元数据、预签名响应和上传参数契约。 */
export namespace InfraFileApi {
  /** 文件信息 */
  export interface File {
    id?: number;
    path: string;
    name?: string;
    url?: string;
    size?: number;
    type?: string;
    createTime?: Date;
  }

  /** 文件预签名地址 */
  export interface FilePresignedUrlRespVO {
    headers: Record<string, string>; // 服务端签名绑定的上传请求头
    uploadUrl: string; // 文件上传 URL
    url: string; // 文件 URL
    path: string; // 文件路径
  }

  /** 上传文件 */
  export interface FileUploadReqVO {
    file: globalThis.File;
    directory?: string;
  }
}

/**
 * 请求文件直传地址，供浏览器上传到对象存储。
 *
 * @param name 待上传文件名；对象路径由后端规范化
 * @param size 文件精确字节数，参与服务端额度和上传签名
 * @param directory 可选业务目录；未传入时由后端采用默认目录
 * @returns 上传地址、必须携带的请求头及最终预约路径
 * @throws 预约失败、响应缺少必要字段或地址协议无效时拒绝
 */
export async function getFilePresignedUrl(
  name: string,
  size: number,
  directory?: string,
) {
  const value = await requestClient.get<unknown>('/infra/file/presigned-url', {
    params: { name, directory, size },
  });
  if (
    typeof value !== 'object' ||
    value === null ||
    !('path' in value) ||
    typeof value.path !== 'string' ||
    !('url' in value) ||
    typeof value.url !== 'string' ||
    !('uploadUrl' in value) ||
    typeof value.uploadUrl !== 'string' ||
    !('headers' in value) ||
    typeof value.headers !== 'object' ||
    value.headers === null ||
    !('Content-Type' in value.headers) ||
    value.headers['Content-Type'] !== 'application/octet-stream' ||
    !('Content-Disposition' in value.headers) ||
    value.headers['Content-Disposition'] !== 'attachment'
  ) {
    throw new Error('上传预约响应格式无效');
  }
  for (const address of [value.url, value.uploadUrl]) {
    const parsed = new URL(address);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error('上传预约地址无效');
    }
  }
  return {
    path: value.path,
    url: value.url,
    uploadUrl: value.uploadUrl,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
    },
  } satisfies InfraFileApi.FilePresignedUrlRespVO;
}

/**
 * 为已经直传到对象存储的文件登记元数据。
 *
 * @param data 文件对象路径、访问地址及可选元数据
 * @returns 服务端确认的文件编号
 * @throws 登记失败或返回编号不是安全正整数时拒绝
 */
export async function createFile(data: InfraFileApi.File) {
  const result = await requestClient.post<unknown>('/infra/file/create', data);
  if (
    typeof result !== 'number' ||
    !Number.isSafeInteger(result) ||
    result < 1
  ) {
    throw new Error('文件登记响应编号无效');
  }
  return result;
}

/**
 * 将文件交由后端上传对象存储并登记元数据。
 *
 * @param data 文件及可选业务目录；空目录字段会在请求前移除
 * @param onUploadProgress 可选上传进度回调
 * @returns 服务端确认的长期访问地址
 * @throws 上传失败或响应不是有效 HTTP 地址时拒绝
 */
export async function uploadFile(
  data: InfraFileApi.FileUploadReqVO,
  onUploadProgress?: AxiosProgressEvent,
) {
  // 上传封装会序列化空目录字段，先移除它以沿用后端的默认目录处理。
  if (!data.directory) {
    delete data.directory;
  }
  const result = await requestClient.upload<unknown>(
    '/infra/file/upload',
    data,
    { onUploadProgress },
  );
  if (typeof result !== 'string') throw new Error('上传响应地址无效');
  const address = new URL(result);
  if (
    !['http:', 'https:'].includes(address.protocol) ||
    address.username ||
    address.password
  ) {
    throw new Error('上传响应地址无效');
  }
  return result;
}

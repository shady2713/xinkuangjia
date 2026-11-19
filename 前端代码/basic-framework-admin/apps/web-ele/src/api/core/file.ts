/**
 * 文件上传接口：供通用上传组件与头像裁剪等核心能力使用，类型直接复用后端 OpenAPI 契约。
 * 核心上传组件通过此模块访问统一对象存储，文件管理页面的查询与删除接口由 infra/file 模块提供。
 */
import type { AxiosRequestConfig } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

/** Axios 上传进度事件 */
export type AxiosProgressEvent = AxiosRequestConfig['onUploadProgress'];

/** 核心上传链路使用的文件元数据、预签名响应和上传参数契约。 */
export namespace InfraFileApi {
  /** 文件信息（源自后端 FileRespVO 契约） */
  export type File = Omit<
    OpenApiSchemas.FileRespVO,
    'createTime' | 'id' | 'name' | 'size' | 'type' | 'url'
  > & {
    createTime?: number;
    id?: number | string;
    name?: string;
    size?: number | string;
    type?: string;
    url?: string;
  };

  /** 文件预签名地址（源自后端 FilePresignedUrlRespVO 契约） */
  export type FilePresignedUrlRespVO = OpenApiSchemas.FilePresignedUrlRespVO;

  /** 上传文件请求参数 */
  export interface FileUploadReqVO {
    file: globalThis.File;
    directory?: string;
  }
}

/**
 * 请求文件直传地址，供浏览器上传到对象存储。
 *
 * @param name 待上传文件名；对象路径由后端规范化
 * @param directory 可选业务目录；未传入时由后端采用默认目录
 * @returns 上传地址、长期访问地址及后端分配的对象路径
 */
export function getFilePresignedUrl(name: string, directory?: string) {
  return requestClient.get<InfraFileApi.FilePresignedUrlRespVO>(
    '/infra/file/presigned-url',
    {
      params: { name, directory },
    },
  );
}

/**
 * 为已经直传到对象存储的文件登记元数据。
 *
 * @param data 文件对象路径、访问地址及可选元数据
 * @returns 后端文件登记结果；请求失败由统一请求客户端处理
 */
export function createFile(data: OpenApiSchemas.FileCreateReqVO) {
  return requestClient.post('/infra/file/create', data);
}

/**
 * 将文件交由后端上传对象存储并登记元数据。
 *
 * @param data 文件及可选业务目录；空目录字段会在请求前移除
 * @param onUploadProgress 可选上传进度回调
 * @returns 后端返回的文件访问地址；请求失败由统一请求客户端处理
 */
export function uploadFile(
  data: InfraFileApi.FileUploadReqVO,
  onUploadProgress?: AxiosProgressEvent,
) {
  // 上传封装会序列化空目录字段，先移除它以沿用后端的默认目录处理。
  if (!data.directory) {
    delete data.directory;
  }
  return requestClient.upload('/infra/file/upload', data, { onUploadProgress });
}

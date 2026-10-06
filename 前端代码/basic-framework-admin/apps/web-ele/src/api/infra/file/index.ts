/**
 * 文件管理接口：文件列表分页查询、单条删除与批量删除。
 * 预签名、创建文件记录与上传复用 api/core/file 的统一上传协议，
 * 本模块不再保留不带预约大小的旧上传请求。
 */
import type { AxiosRequestConfig, PageParam, PageResult } from '@vben/request';

import { requestClient } from '#/api/request';

/** Axios 上传进度事件 */
export type AxiosProgressEvent = AxiosRequestConfig['onUploadProgress'];

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
    headers: Record<string, string>; // 签名绑定的请求头
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
 * 分页查询文件记录。
 * @param params 分页与筛选条件，由文件管理页按当前筛选表单拼装。
 * @returns 当前页的文件记录及总条数，不含文件内容本身。
 */
export function getFilePage(params: PageParam) {
  return requestClient.get<PageResult<InfraFileApi.File>>('/infra/file/page', {
    params,
  });
}

/**
 * 删除单个文件记录。
 * @param id 文件编号；后端先删对象存储中的文件再删记录，编号不存在时按业务码拒绝。
 * @returns 删除结果标识。
 */
export function deleteFile(id: number) {
  return requestClient.delete(`/infra/file/delete?id=${id}`);
}

/**
 * 批量删除文件记录及其对象存储内容。
 * @param ids 文件编号数组，以逗号拼入查询串，单次最多 100 条；
 *             查不到的编号会被跳过，后端逐个先删存储对象再删记录。
 * @returns 删除结果标识；中途存储删除失败时请求报错，已删除的部分不回滚，刷新列表后重试剩余项。
 */
export function deleteFileList(ids: number[]) {
  return requestClient.delete(`/infra/file/delete-list?ids=${ids.join(',')}`);
}

/** 统一复用核心上传协议，避免文件管理页保留不带预约大小的旧请求。 */
export { createFile, getFilePresignedUrl, uploadFile } from '#/api/core/file';

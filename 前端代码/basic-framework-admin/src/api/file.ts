/**
 * 文件上传、私有文件鉴权下载与文件记录管理接口。
 */
import type { AxiosProgressEvent } from 'axios';

import type { OpenApiSchemas } from '@/api/generated/api-types';
import type { PageParam, PageResult } from '@/api/request';

import { request } from '@/api/request';

export type FileRecord = OpenApiSchemas.FileRespVO;

export function uploadFileApi(
  file: File,
  directory?: string,
  onProgress?: (e: AxiosProgressEvent) => void,
) {
  const formData = new FormData();
  formData.append('file', file);
  if (directory) {
    formData.append('directory', directory);
  }
  return request.upload<string>('/infra/file/upload', formData, onProgress);
}

export function getPrivateFileContentApi(id: number | string) {
  return request.download('/infra/file/private/content', {
    params: { id },
  });
}

export function getFilePageApi(params: PageParam) {
  return request.get<PageResult<FileRecord>>('/infra/file/page', { params });
}

export function deleteFileApi(id: number | string) {
  return request.delete<boolean>('/infra/file/delete', { params: { id } });
}

export function deleteFileListApi(ids: (number | string)[]) {
  return request.delete<boolean>(
    `/infra/file/delete-list?ids=${ids.join(',')}`,
  );
}

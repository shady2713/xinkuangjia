/**
 * 基础设施文件管理接口封装，复用公共上传能力并提供后台分页查询与删除接口。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { InfraFileApi as CoreInfraFileApi } from '#/api/core/file';

import { requestClient } from '#/api/request';

export {
  type AxiosProgressEvent,
  createFile,
  getFilePresignedUrl,
  uploadFile,
} from '#/api/core/file';

export namespace InfraFileApi {
  /** 文件记录信息（源自后端 FileRespVO 契约）。 */
  export type File = CoreInfraFileApi.File & {
    configId?: number;
  };

  /** 文件预签名上传地址响应结构。 */
  export type FilePresignedUrlRespVO = CoreInfraFileApi.FilePresignedUrlRespVO;

  /** 文件直传参数结构。 */
  export type FileUploadReqVO = CoreInfraFileApi.FileUploadReqVO;
}

/**
 * 查询文件分页列表。
 *
 * @param params 分页查询参数
 * @returns 文件分页结果
 */
export function getFilePage(params: PageParam) {
  return requestClient.get<PageResult<InfraFileApi.File>>('/infra/file/page', {
    params,
  });
}

/**
 * 删除单个文件记录。
 *
 * @param id 文件主键编号
 * @returns 删除结果
 */
export function deleteFile(id: number | string) {
  return requestClient.delete(`/infra/file/delete?id=${id}`);
}

/**
 * 批量删除文件记录。
 *
 * @param ids 待删除的文件主键编号列表
 * @returns 批量删除结果
 */
export function deleteFileList(ids: (number | string)[]) {
  return requestClient.delete(`/infra/file/delete-list?ids=${ids.join(',')}`);
}

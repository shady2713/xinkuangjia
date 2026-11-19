/**
 * 岗位管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemPostApi {
  /** 岗位信息（源自后端 PostRespVO 契约） */
  export type Post = Omit<OpenApiSchemas.PostRespVO, 'id'> & {
    id?: number | string;
  };
}

/**
 * 分页查询岗位列表。
 *
 * @param params 分页与筛选参数
 * @returns 岗位分页结果
 */
export function getPostPage(params: PageParam) {
  return requestClient.get<PageResult<SystemPostApi.Post>>(
    '/system/post/page',
    {
      params,
    },
  );
}

/**
 * 获取岗位精简信息列表。
 *
 * @returns 岗位精简列表
 */
export function getSimplePostList() {
  return requestClient.get<OpenApiSchemas.PostSimpleRespVO[]>(
    '/system/post/simple-list',
  );
}

/**
 * 查询岗位详情。
 *
 * @param id 岗位主键编号
 * @returns 岗位详情
 */
export function getPost(id: number | string) {
  return requestClient.get<SystemPostApi.Post>(`/system/post/get?id=${id}`);
}

/**
 * 新增岗位。
 *
 * @param data 岗位保存请求
 * @returns 新建岗位编号
 */
export function createPost(data: OpenApiSchemas.PostSaveReqVO) {
  return requestClient.post('/system/post/create', data);
}

/**
 * 修改岗位。
 *
 * @param data 岗位保存请求
 * @returns 修改结果
 */
export function updatePost(data: OpenApiSchemas.PostSaveReqVO) {
  return requestClient.put('/system/post/update', data);
}

/**
 * 删除单个岗位。
 *
 * @param id 岗位主键编号
 * @returns 删除结果
 */
export function deletePost(id: number | string) {
  return requestClient.delete(`/system/post/delete?id=${id}`);
}

/**
 * 批量删除岗位。
 *
 * @param ids 岗位编号集合
 * @returns 批量删除结果
 */
export function deletePostList(ids: (number | string)[]) {
  return requestClient.delete(`/system/post/delete-list?ids=${ids.join(',')}`);
}

/**
 * 导出岗位 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportPost(params: PageParam) {
  return requestClient.download('/system/post/export-excel', {
    params,
  });
}

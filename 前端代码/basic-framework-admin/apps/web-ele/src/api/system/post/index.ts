/**
 * 岗位管理接口：分页、增删改查与导出。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace SystemPostApi {
  /** 岗位信息 */
  export interface Post {
    id?: number;
    name: string;
    code: string;
    sort: number;
    status: number;
    remark: string;
    createTime?: Date;
  }
}

/**
 * 分页查询岗位列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含岗位记录列表与总条数。
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
 * 查询全部岗位的精简列表，用于下拉选择。
 * @returns 岗位的精简列表，不含详情字段。
 */
export function getSimplePostList() {
  return requestClient.get<SystemPostApi.Post[]>('/system/post/simple-list');
}

/**
 * 按主键查询单个岗位。
 * @param id 目标岗位的主键。
 * @returns 岗位详情。
 */
export function getPost(id: number) {
  return requestClient.get<SystemPostApi.Post>(`/system/post/get?id=${id}`);
}

/**
 * 新增岗位。
 * @param data 待保存的岗位数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function createPost(data: SystemPostApi.Post) {
  return requestClient.post('/system/post/create', data);
}

/**
 * 修改岗位。
 * @param data 待保存的岗位数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updatePost(data: SystemPostApi.Post) {
  return requestClient.put('/system/post/update', data);
}

/**
 * 删除指定岗位。
 * @param id 目标岗位的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deletePost(id: number) {
  return requestClient.delete(`/system/post/delete?id=${id}`);
}

/**
 * 批量删除岗位。
 * @param ids 待批量操作的岗位主键集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deletePostList(ids: number[]) {
  return requestClient.delete(`/system/post/delete-list?ids=${ids.join(',')}`);
}

/**
 * 按当前筛选条件导出岗位，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportPost(params: ExportQuery) {
  return requestClient.download('/system/post/export-excel', {
    params,
  });
}

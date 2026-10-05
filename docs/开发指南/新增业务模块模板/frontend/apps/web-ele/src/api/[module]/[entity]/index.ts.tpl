/**
 * [entity-title]接口：分页查询、详情、新增、修改与删除。
 *
 * 请求地址必须与后端 Controller 的 @RequestMapping("/[module]/[entity]") 及各方法路径一致；
 * 参数名必须与后端 VO 字段一致，否则后端收到空条件后返回全量数据。
 */
import type { PageResult } from '@vben/request';

import type { [Entity], [Entity]PageParams } from './types';

import { requestClient } from '#/api/request';

// 页面按模块路径导入类型（#/api/[module]/[entity]），因此这里把 types.ts 的类型重新导出，
// 避免页面跨文件引用模块内部路径。
export type { [Entity], [Entity]PageParams };

/**
 * 分页查询[entity-name]。
 * @param params 分页与筛选参数，字段含义与后端 [Entity]PageReqVO 一致。
 * @returns 分页结果，含记录列表与总条数。
 */
export function get[Entity]Page(params: [Entity]PageParams) {
  return requestClient.get<PageResult<[Entity]>>('/[module]/[entity]/page', {
    params,
  });
}

/**
 * 按编号查询[entity-name]详情。
 * @param id 目标记录编号。
 * @returns 记录详情；记录不存在时后端返回空数据。
 */
export function get[Entity](id: number) {
  return requestClient.get<[Entity]>(`/[module]/[entity]/get?id=${id}`);
}

/**
 * 新增[entity-name]。
 * @param data 待保存的记录；编号置空由后端生成。
 * @returns 新增记录编号。
 */
export function create[Entity](data: [Entity]) {
  return requestClient.post<number>('/[module]/[entity]/create', data);
}

/**
 * 修改[entity-name]。
 * @param data 待保存的记录；必须携带 id。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function update[Entity](data: [Entity]) {
  return requestClient.put('/[module]/[entity]/update', data);
}

/**
 * 删除[entity-name]。
 * @param id 目标记录编号。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function delete[Entity](id: number) {
  return requestClient.delete(`/[module]/[entity]/delete?id=${id}`);
}

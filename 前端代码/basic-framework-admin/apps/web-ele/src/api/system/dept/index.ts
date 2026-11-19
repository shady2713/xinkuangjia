/**
 * 部门管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemDeptApi {
  /** 部门信息（源自后端 DeptRespVO 契约） */
  export type Dept = Omit<OpenApiSchemas.DeptRespVO, 'id'> & {
    children?: Dept[];
    id?: number | string;
  };
}

/**
 * 查询部门精简列表。
 *
 * @returns 精简部门列表
 */
export async function getSimpleDeptList() {
  return requestClient.get<OpenApiSchemas.DeptSimpleRespVO[]>(
    '/system/dept/simple-list',
  );
}

/**
 * 查询完整部门列表。
 *
 * @returns 部门列表
 */
export async function getDeptList() {
  return requestClient.get<SystemDeptApi.Dept[]>('/system/dept/list');
}

/**
 * 查询部门详情。
 *
 * @param id 部门主键编号
 * @returns 部门详情
 */
export async function getDept(id: number | string) {
  return requestClient.get<SystemDeptApi.Dept>(`/system/dept/get?id=${id}`);
}

/**
 * 新增部门。
 *
 * @param data 部门保存请求
 * @returns 新建部门编号
 */
export async function createDept(data: OpenApiSchemas.DeptSaveReqVO) {
  return requestClient.post('/system/dept/create', data);
}

/**
 * 修改部门。
 *
 * @param data 部门保存请求
 * @returns 修改结果
 */
export async function updateDept(data: OpenApiSchemas.DeptSaveReqVO) {
  return requestClient.put('/system/dept/update', data);
}

/**
 * 删除单个部门。
 *
 * @param id 部门主键编号
 * @returns 删除结果
 */
export async function deleteDept(id: number | string) {
  return requestClient.delete(`/system/dept/delete?id=${id}`);
}

/**
 * 批量删除部门。
 *
 * @param ids 部门编号集合
 * @returns 批量删除结果
 */
export async function deleteDeptList(ids: (number | string)[]) {
  return requestClient.delete(`/system/dept/delete-list?ids=${ids.join(',')}`);
}

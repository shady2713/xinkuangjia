/** 部门传输契约；列表在进入树形选择器前验证字段及整数编号。 */
import { isRecord } from '@vben/request';

import { requestClient } from '#/api/request';

export namespace SystemDeptApi {
  /** 部门信息 */
  export interface Dept {
    id?: number;
    name: string;
    parentId?: number;
    status: number;
    sort: number;
    leaderUserId: null | number;
    phone: string;
    email: string;
    createTime: number;
    children?: Dept[];
  }
}

/**
 * 查询部门精简列表，供部门选择器等下拉场景使用。
 * @returns 后端只返回状态为开启的部门，每项仅含 id、name、parentId 三个字段，未做契约校验。
 */
export async function getSimpleDeptList() {
  return requestClient.get<SystemDeptApi.Dept[]>('/system/dept/simple-list');
}

/** 查询并验证完整部门列表。
 * @returns 可用于列表及树形选择器的部门记录。
 * @throws {TypeError} 响应不是数组或部门字段无效。
 */
export async function getDeptList() {
  const value = await requestClient.get<unknown>('/system/dept/list');
  if (!Array.isArray(value)) throw new TypeError('部门列表必须是数组');
  return value.map(
    /** 对每个完整部门单独执行接口契约校验。 */ (item: unknown) =>
      parseDept(item),
  );
}

/** 校验完整部门列表的单项传输值，拒绝伪造编号及非数字时间。
 * @param value 尚未验证的部门记录。
 * @returns 已验证的完整部门展示字段。
 * @throws {TypeError} 记录、编号、状态或展示字段不符合后端响应契约。
 */
function parseDept(value: unknown): SystemDeptApi.Dept {
  if (
    !isRecord(value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0 ||
    typeof value.parentId !== 'number' ||
    !Number.isSafeInteger(value.parentId) ||
    value.parentId < 0 ||
    typeof value.name !== 'string' ||
    typeof value.status !== 'number' ||
    !Number.isInteger(value.status) ||
    typeof value.sort !== 'number' ||
    !Number.isInteger(value.sort) ||
    (value.leaderUserId !== null &&
      value.leaderUserId !== undefined &&
      (typeof value.leaderUserId !== 'number' ||
        !Number.isSafeInteger(value.leaderUserId))) ||
    (value.phone !== null &&
      value.phone !== undefined &&
      typeof value.phone !== 'string') ||
    (value.email !== null &&
      value.email !== undefined &&
      typeof value.email !== 'string') ||
    typeof value.createTime !== 'number' ||
    !Number.isSafeInteger(value.createTime)
  ) {
    throw new TypeError('部门响应字段无效');
  }
  return {
    id: value.id,
    parentId: value.parentId,
    name: value.name,
    status: value.status,
    sort: value.sort,
    leaderUserId: value.leaderUserId ?? null,
    phone: value.phone ?? '',
    email: value.email ?? '',
    createTime: value.createTime,
  };
}

/**
 * 查询部门详情。
 * @param id 部门编号；编号不存在时后端按业务码拒绝。
 * @returns 部门完整字段，含负责人、联系方式与创建时间，未做契约校验。
 */
export async function getDept(id: number) {
  return requestClient.get<SystemDeptApi.Dept>(`/system/dept/get?id=${id}`);
}

/**
 * 新增部门。
 * @param data 部门表单数据，编号由后端生成，不应由调用方传入。
 * @returns 新建部门的编号。
 */
export async function createDept(data: SystemDeptApi.Dept) {
  return requestClient.post('/system/dept/create', data);
}

/**
 * 修改部门。
 * @param data 部门表单数据，必须携带已有部门编号，编号不存在时后端按业务码拒绝。
 * @returns 更新结果标识。
 */
export async function updateDept(data: SystemDeptApi.Dept) {
  return requestClient.put('/system/dept/update', data);
}

/**
 * 删除部门。
 * @param id 部门编号；部门编号不存在或仍有子部门时后端按业务码拒绝，不级联删除子部门。
 * @returns 删除结果标识。
 */
export async function deleteDept(id: number) {
  return requestClient.delete(`/system/dept/delete?id=${id}`);
}

/**
 * 批量删除部门。
 * @param ids 部门编号数组，以逗号拼入查询串；每个编号都须存在，
 *            且不能存在本次不一起删除的子部门，否则后端拒绝整批删除。
 * @returns 删除结果标识。
 */
export async function deleteDeptList(ids: number[]) {
  return requestClient.delete(`/system/dept/delete-list?ids=${ids.join(',')}`);
}

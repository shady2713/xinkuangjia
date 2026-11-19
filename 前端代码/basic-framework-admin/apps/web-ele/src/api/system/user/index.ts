/**
 * 系统用户管理接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { PageParam, PageResult } from '@vben/request';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemUserApi {
  /** 用户信息（源自后端 UserRespVO / UserSaveReqVO 契约） */
  export type User = {
    id?: number | string;
    /** 仅创建用户时提交的密码密文；用户详情响应不返回此字段。 */
    password?: string;
  } & Omit<OpenApiSchemas.UserRespVO, 'id'>;

  /** 用户保存请求（源自后端 UserSaveReqVO 契约；编辑场景无需传递密码） */
  export type UserSaveReq = {
    /** 仅创建用户时提交的密码密文；编辑用户时无需提交密码。 */
    password?: string;
  } & Omit<OpenApiSchemas.UserSaveReqVO, 'password'>;

  /** 用户导入结果（源自后端 UserImportRespVO 契约） */
  export type UserImportResp = OpenApiSchemas.UserImportRespVO;
}

/**
 * 查询用户管理分页列表。
 *
 * @param params 分页与筛选参数
 * @returns 用户分页结果
 */
export function getUserPage(params: PageParam) {
  return requestClient.get<PageResult<SystemUserApi.User>>(
    '/system/user/page',
    { params },
  );
}

/**
 * 查询用户详情。
 *
 * @param id 用户主键编号
 * @returns 用户详情
 */
export function getUser(id: number | string) {
  return requestClient.get<SystemUserApi.User>(`/system/user/get?id=${id}`);
}

/**
 * 新增用户。
 *
 * @param data 用户提交参数
 * @returns 新建用户编号
 */
export function createUser(data: SystemUserApi.UserSaveReq) {
  return requestClient.post('/system/user/create', data);
}

/**
 * 修改用户。
 *
 * @param data 用户提交参数
 * @returns 修改结果
 */
export function updateUser(data: SystemUserApi.UserSaveReq) {
  return requestClient.put('/system/user/update', data);
}

/**
 * 删除单个用户。
 *
 * @param id 用户主键编号
 * @returns 删除结果
 */
export function deleteUser(id: number | string) {
  return requestClient.delete(`/system/user/delete?id=${id}`);
}

/**
 * 批量删除用户。
 *
 * @param ids 用户编号集合
 * @returns 批量删除结果
 */
export function deleteUserList(ids: (number | string)[]) {
  return requestClient.delete(`/system/user/delete-list?ids=${ids.join(',')}`);
}

/**
 * 导出用户 Excel。
 *
 * @param params 导出筛选参数
 * @returns Excel 文件流
 */
export function exportUser(params: PageParam) {
  return requestClient.download('/system/user/export-excel', { params });
}

/**
 * 下载用户导入模板。
 *
 * @returns 模板 Excel 文件流
 */
export function importUserTemplate() {
  return requestClient.download('/system/user/get-import-template');
}

/**
 * 导入用户 Excel。
 *
 * @param file Excel 文件
 * @param updateSupport 是否覆盖更新已有用户
 * @returns 导入汇总结果
 */
export function importUser(file: File, updateSupport: boolean) {
  return requestClient.upload<SystemUserApi.UserImportResp>(
    '/system/user/import',
    {
      file,
      updateSupport,
    },
  );
}

/**
 * 管理员重置用户密码。
 *
 * @param id 用户编号
 * @param password SM2 加密后的新密码密文
 * @returns 重置结果
 */
export function resetUserPassword(id: number | string, password: string) {
  return requestClient.put('/system/user/update-password', { id, password });
}

/**
 * 修改用户启用/停用状态。
 *
 * @param id 用户编号
 * @param status 目标状态
 * @returns 更新结果
 */
export function updateUserStatus(id: number | string, status: number) {
  return requestClient.put('/system/user/update-status', { id, status });
}

/**
 * 获取用户精简信息列表。
 *
 * @returns 启用用户精简列表
 */
export function getSimpleUserList() {
  return requestClient.get<OpenApiSchemas.UserSimpleRespVO[]>(
    '/system/user/simple-list',
  );
}

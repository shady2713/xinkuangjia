/**
 * 用户管理接口：分页、增删改查、导入导出与密码重置。
 */
import type { PageParam, PageResult } from '@vben/request';

import type { ExportQuery } from '../../typing';

import { requestClient } from '#/api/request';

export namespace SystemUserApi {
  /** 用户信息 */
  export interface User {
    id?: number;
    username: string;
    /** 仅创建用户时提交的密码摘要；用户详情响应不返回此字段。 */
    password?: string;
    nickname: string;
    deptId: number;
    postIds: string[];
    email: string;
    mobile: string;
    sex: number;
    avatar: string;
    loginIp: string;
    status: number;
    remark: string;
    createTime?: Date;
  }

  /** 用户导入结果 */
  export interface UserImportResp {
    createUsernames: string[];
    updateUsernames: string[];
    failureUsernames: Record<string, string>;
  }
}

/**
 * 分页查询用户列表。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 分页结果，含用户记录列表与总条数。
 */
export function getUserPage(params: PageParam) {
  return requestClient.get<PageResult<SystemUserApi.User>>(
    '/system/user/page',
    { params },
  );
}

/**
 * 按主键查询单个用户。
 * @param id 目标用户的主键。
 * @returns 用户详情。
 */
export function getUser(id: number) {
  return requestClient.get<SystemUserApi.User>(`/system/user/get?id=${id}`);
}

/**
 * 新增用户。
 * @param data 待保存的用户数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function createUser(data: SystemUserApi.User) {
  return requestClient.post('/system/user/create', data);
}

/**
 * 修改用户。
 * @param data 待保存的用户数据，主键是否落库由后端按当前值判断。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateUser(data: SystemUserApi.User) {
  return requestClient.put('/system/user/update', data);
}

/**
 * 删除指定用户。
 * @param id 目标用户的主键。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteUser(id: number) {
  return requestClient.delete(`/system/user/delete?id=${id}`);
}

/**
 * 批量删除用户。
 * @param ids 待批量操作的用户主键集合。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function deleteUserList(ids: number[]) {
  return requestClient.delete(`/system/user/delete-list?ids=${ids.join(',')}`);
}

/**
 * 按当前筛选条件导出用户，不接受分页参数。
 * @param params 请求参数，字段含义与后端接口定义一致。
 * @returns 导出文件流，由调用方触发浏览器下载。
 */
export function exportUser(params: ExportQuery) {
  return requestClient.download('/system/user/export-excel', { params });
}

/**
 * 下载用户导入模板。
 * @returns 模板文件流，由调用方触发浏览器下载。
 */
export function importUserTemplate() {
  return requestClient.download('/system/user/get-import-template');
}

/**
 * 按模板导入用户。
 * @param file 待导入的文件，直接传入浏览器 File 对象。
 * @param updateSupport 是否覆盖更新：true 表示按唯一标识更新已有记录而非新增。
 * @returns 导入结果，含成功条数与失败明细。
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
 * 重置指定用户的登录密码。
 * @param id 目标用户的主键。
 * @param password 重置后的明文密码，由后端加密后存储。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function resetUserPassword(id: number, password: string) {
  return requestClient.put('/system/user/update-password', { id, password });
}

/**
 * 更新用户的启用状态。
 * @param id 目标用户的主键。
 * @param status 目标用户状态值，取值见业务状态枚举。
 * @returns 后端无返回体，失败时由请求层统一抛出错误。
 */
export function updateUserStatus(id: number, status: number) {
  return requestClient.put('/system/user/update-status', { id, status });
}

/**
 * 查询全部用户的精简列表，用于下拉选择。
 * @returns 用户的精简列表，不含详情字段。
 */
export function getSimpleUserList() {
  return requestClient.get<SystemUserApi.User[]>('/system/user/simple-list');
}

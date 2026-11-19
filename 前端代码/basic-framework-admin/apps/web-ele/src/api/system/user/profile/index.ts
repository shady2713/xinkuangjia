/**
 * 个人中心接口封装，类型直接复用后端 OpenAPI 契约。
 *
 * @author shady2713
 */
import type { OpenApiSchemas } from '#/api/generated/api-types';

import { requestClient } from '#/api/request';

export namespace SystemUserProfileApi {
  /** 用户个人中心信息（源自后端 UserProfileRespVO 契约） */
  export type UserProfileRespVO = OpenApiSchemas.UserProfileRespVO;

  /** 更新密码请求（源自后端 UserProfileUpdatePasswordReqVO 契约） */
  export type UpdatePasswordReqVO =
    OpenApiSchemas.UserProfileUpdatePasswordReqVO;

  /** 更新个人信息请求（源自后端 UserProfileUpdateReqVO 契约） */
  export type UpdateProfileReqVO = OpenApiSchemas.UserProfileUpdateReqVO;
}

/**
 * 获取当前登录用户个人资料。
 *
 * @returns 用户个人中心详情
 */
export function getUserProfile() {
  return requestClient.get<SystemUserProfileApi.UserProfileRespVO>(
    '/system/user/profile/get',
  );
}

/**
 * 修改当前登录用户个人资料。
 *
 * @param data 个人资料更新请求
 * @returns 更新结果
 */
export function updateUserProfile(
  data: SystemUserProfileApi.UpdateProfileReqVO,
) {
  return requestClient.put('/system/user/profile/update', data);
}

/**
 * 修改当前登录用户个人密码。
 *
 * @param data 旧密码与新密码（SM2 密文）
 * @returns 更新结果
 */
export function updateUserPassword(
  data: SystemUserProfileApi.UpdatePasswordReqVO,
) {
  return requestClient.put('/system/user/profile/update-password', data);
}

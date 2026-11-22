/**
 * 个人中心资料与密码修改接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';

import { request } from '@/api/request';

export type UserProfileResp = OpenApiSchemas.UserProfileRespVO;
export type UpdateProfileReq = OpenApiSchemas.UserProfileUpdateReqVO;
export type UpdatePasswordReq = OpenApiSchemas.UserProfileUpdatePasswordReqVO;

export function getUserProfileApi() {
  return request.get<UserProfileResp>('/system/user/profile/get');
}

export function updateUserProfileApi(data: UpdateProfileReq) {
  return request.put<boolean>('/system/user/profile/update', data);
}

export function updateUserPasswordApi(data: UpdatePasswordReq) {
  return request.put<boolean>('/system/user/profile/update-password', data);
}

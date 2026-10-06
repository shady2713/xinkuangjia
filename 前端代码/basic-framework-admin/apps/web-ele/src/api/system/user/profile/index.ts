/**
 * 个人中心接口：读取当前登录用户的资料，并修改本人资料与登录密码。
 * 只操作登录者自身的数据，后台维护他人账号的接口在 api/system/user。
 */
import { requestClient } from '#/api/request';

export namespace SystemUserProfileApi {
  /** 用户个人中心信息 */
  export interface UserProfileRespVO {
    id: number;
    username: string;
    nickname: string;
    email?: string;
    mobile?: string;
    sex?: number;
    avatar?: string;
    loginIp: string;
    loginDate: string;
    createTime: string;
    roles: { id: number; name: string }[];
    dept: null | { id: number; name: string };
    posts: { id: number; name: string }[];
  }

  /** 更新密码请求 */
  export interface UpdatePasswordReqVO {
    oldPassword: string;
    newPassword: string;
  }

  /** 更新个人信息请求 */
  export interface UpdateProfileReqVO {
    nickname?: string;
    email?: string;
    mobile?: string;
    sex?: number;
    avatar?: string;
  }
}

/**
 * 获取当前登录用户的个人中心信息。
 * @returns 本人资料，含角色、所属部门与岗位；后端按登录身份取值，不接受用户编号参数。
 */
export function getUserProfile() {
  return requestClient.get<SystemUserProfileApi.UserProfileRespVO>(
    '/system/user/profile/get',
  );
}

/**
 * 修改当前登录用户的个人信息。
 * @param data 只提交需要变更的字段；用户名、角色与部门由后台维护，此处不可修改。
 * @returns 更新结果标识；手机号或邮箱已被他人占用时后端按业务码拒绝。
 */
export function updateUserProfile(
  data: SystemUserProfileApi.UpdateProfileReqVO,
) {
  return requestClient.put('/system/user/profile/update', data);
}

/**
 * 修改当前登录用户的登录密码。
 * @param data 原密码与新密码，均为前端生成的 32 位十六进制摘要，服务端不接触原始口令。
 * @returns 更新结果标识；原密码校验失败时不写入新密码并按业务码拒绝。
 *             改密成功后后端会一并删除该用户已签发的访问令牌，调用方需据此回到登录界面。
 */
export function updateUserPassword(
  data: SystemUserProfileApi.UpdatePasswordReqVO,
) {
  return requestClient.put('/system/user/profile/update-password', data);
}

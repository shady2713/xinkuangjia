/** 认证 HTTP 入口：凭据及权限响应通过运行时契约后才交给状态层。 */
import type {
  CaptchaCheckResponse,
  CaptchaFetchResponse,
  CaptchaRequestBody,
} from '@vben/common-ui';
import type { AxiosResponse } from '@vben/request';

import { baseRequestClient, requestClient } from '#/api/request';

import {
  parseLoginResult,
  parsePermissionInfo,
  parseSuccessData,
} from './auth-contract';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password: string;
    username: string;
    captchaVerification?: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
    refreshToken: string;
    userId: number;
    expiresTime: number;
  }

  /** 手机验证码获取接口参数 */
  export interface SmsCodeParams {
    mobile: string;
    scene: number;
  }

  /** 手机验证码登录接口参数 */
  export interface SmsLoginParams {
    mobile: string;
    code: string;
  }

  /** 注册接口参数 */
  export interface RegisterParams {
    username: string;
    password: string;
    captchaVerification: string;
  }

  /** 重置密码接口参数 */
  export interface ResetPasswordParams {
    password: string;
    mobile: string;
    code: string;
  }
}

/** 使用管理员入口登录并验证凭据。
 * @param data 账号、密码及验证结果。
 * @returns 已验证的登录凭据。
 * @throws {TypeError} 服务端登录结果不符合凭据契约。
 */
export async function loginApi(data: AuthApi.LoginParams) {
  // 新管理平台使用独立登录入口，后端会校验账号 user__type 必须为 super_admin。
  const result = await requestClient.post<unknown>(
    '/system/auth/super-admin-login',
    data,
    {
      headers: {
        isEncrypt: false,
      },
    },
  );
  return parseLoginResult(result);
}

/** 换取并验证轮换后的访问和刷新令牌。
 * @param refreshToken 当前身份的刷新令牌。
 * @returns 已确认业务成功且字段有效的登录凭据。
 * @throws {Error} 刷新被拒绝或响应字段无效。
 */
export async function refreshTokenApi(refreshToken: string) {
  const response = await baseRequestClient.post<AxiosResponse<unknown>>(
    '/system/auth/refresh-token',
    {
      refreshToken,
    },
  );
  return parseLoginResult(parseSuccessData(response.data));
}

/** 退出登录 */
export async function logoutApi(accessToken: string) {
  return baseRequestClient.post(
    '/system/auth/logout',
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
}

/** 获取并验证当前身份及权限菜单。
 * @returns 经过边界校验并规范化的身份、角色及权限。
 * @throws {TypeError} 任一身份或权限字段不符合接口契约。
 */
export async function getAuthPermissionInfoApi() {
  const result = await requestClient.get<unknown>(
    '/system/auth/get-permission-info',
  );
  return parsePermissionInfo(result);
}

/**
 * 获取验证码
 * @param data 请求体，captchaType 决定后端返回点选文字还是滑块拼图验证码
 * @returns 后端下发的验证码数据：背景图、令牌与可选的 AES 密钥
 */
export async function getCaptcha(
  data: CaptchaRequestBody,
): Promise<CaptchaFetchResponse> {
  return baseRequestClient.post('/system/captcha/get', data);
}

/**
 * 校验验证码
 * @description 组件提交的是 token 与坐标密文（pointJson），后端未开启加密时为明文坐标
 * @param data 校验请求体
 * @returns repCode 为 '0000' 表示校验通过，repMsg 为失败原因
 */
export async function checkCaptcha(
  data: CaptchaRequestBody,
): Promise<CaptchaCheckResponse> {
  return baseRequestClient.post('/system/captcha/check', data);
}

/** 获取登录验证码 */
export async function sendSmsCode(data: AuthApi.SmsCodeParams) {
  return requestClient.post('/system/auth/send-sms-code', data);
}

/** 校验短信登录返回的完整凭据。
 * @param data 手机号码与短信验证码。
 * @returns 已验证的登录结果。
 * @throws {TypeError} 凭据字段无效。
 */
export async function smsLogin(data: AuthApi.SmsLoginParams) {
  return parseLoginResult(
    await requestClient.post<unknown>('/system/auth/sms-login', data),
  );
}

/** 对部署允许注册时的登录结果应用同一认证边界。
 * @param data 注册账号、密码和人机验证结果。
 * @returns 已验证的登录凭据。
 * @throws {TypeError} 凭据字段无效。
 */
export async function register(data: AuthApi.RegisterParams) {
  return parseLoginResult(
    await requestClient.post<unknown>('/system/auth/register', data),
  );
}

/** 通过短信重置密码 */
export async function smsResetPassword(data: AuthApi.ResetPasswordParams) {
  return requestClient.post('/system/auth/reset-password', data);
}

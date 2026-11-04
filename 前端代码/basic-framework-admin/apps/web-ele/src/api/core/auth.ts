import type { AuthPermissionInfo } from '@vben/types';

import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password?: string;
    username?: string;
    captchaVerification?: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
    refreshToken: string;
    userId: number;
    expiresTime: number;
    /** 首次登录或管理员重置密码后为 true，前端需先跳转修改密码。 */
    passwordChangeRequired?: boolean;
  }

  /** SM2 密码传输公钥 */
  export interface Sm2PublicKeyResult {
    /** 带 04 前缀的未压缩公钥 */
    publicKey: string;
    /** 1 表示 C1C3C2 */
    cipherMode: 1;
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

/**
 * 使用账号密码登录新管理平台。
 *
 * @param data 登录参数，密码字段为 SM2 密文
 * @returns 访问令牌和首次改密标志
 */
export async function loginApi(data: AuthApi.LoginParams) {
  // 新管理平台使用独立登录入口，后端会校验账号 user__type 必须为 super_admin。
  return requestClient.post<AuthApi.LoginResult>(
    '/system/auth/super-admin-login',
    data,
    {
      headers: {
        // 密码字段已使用 SM2 单独加密，登录请求不叠加 API 整体加密。
        isEncrypt: false,
      },
    },
  );
}

/** 刷新 accessToken */
export async function refreshTokenApi(refreshToken: string) {
  return baseRequestClient.post('/system/auth/refresh-token', {
    refreshToken,
  });
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

/** 获取权限信息 */
export async function getAuthPermissionInfoApi() {
  return requestClient.get<AuthPermissionInfo>(
    '/system/auth/get-permission-info',
  );
}

/**
 * 获取密码传输 SM2 公钥。
 *
 * @returns 带 04 前缀的未压缩公钥和 C1C3C2 模式
 */
export async function getSm2PublicKey() {
  return requestClient.get<AuthApi.Sm2PublicKeyResult>(
    '/system/auth/sm2-public-key',
  );
}

/** 获取验证码 */
export async function getCaptcha(data: { captchaType: string }) {
  return baseRequestClient.post('/system/captcha/get', data);
}

/** 校验验证码 */
export async function checkCaptcha(data: { captchaVerification: string }) {
  return baseRequestClient.post('/system/captcha/check', data);
}

/** 获取登录验证码 */
export async function sendSmsCode(data: AuthApi.SmsCodeParams) {
  return requestClient.post('/system/auth/send-sms-code', data);
}

/** 短信验证码登录 */
export async function smsLogin(data: AuthApi.SmsLoginParams) {
  return requestClient.post('/system/auth/sms-login', data);
}

/** 注册 */
export async function register(data: AuthApi.RegisterParams) {
  return requestClient.post('/system/auth/register', data);
}

/** 通过短信重置密码 */
export async function smsResetPassword(data: AuthApi.ResetPasswordParams) {
  return requestClient.post('/system/auth/reset-password', data);
}

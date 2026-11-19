import type { AuthPermissionInfo } from '@vben/types';

import type { OpenApiSchemas } from '#/api/generated/api-types';

import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数（源自后端 AuthLoginReqVO 契约） */
  export type LoginParams = Partial<OpenApiSchemas.AuthLoginReqVO>;

  /** 登录接口返回值（源自后端 AuthLoginRespVO 契约） */
  export type LoginResult = OpenApiSchemas.AuthLoginRespVO;

  /** SM2 密码传输公钥（源自后端 Sm2PublicKeyRespVO 契约） */
  export type Sm2PublicKeyResult = OpenApiSchemas.Sm2PublicKeyRespVO;

  /** 手机验证码发送接口参数（源自后端 AuthSmsSendReqVO 契约；关闭验证码时 captchaVerification 可为空） */
  export type SmsCodeParams = Omit<
    OpenApiSchemas.AuthSmsSendReqVO,
    'captchaVerification'
  > & {
    captchaVerification?: string;
  };

  /** 手机验证码登录接口参数（源自后端 AuthSmsLoginReqVO 契约） */
  export type SmsLoginParams = OpenApiSchemas.AuthSmsLoginReqVO;

  /** 重置密码接口参数（源自后端 AuthResetPasswordReqVO 契约） */
  export type ResetPasswordParams = OpenApiSchemas.AuthResetPasswordReqVO;
}

/**
 * 使用账号密码登录管理平台。
 *
 * @param data 登录参数，密码字段为 SM2 密文
 * @returns 访问令牌和首次改密标志
 */
export async function loginApi(data: AuthApi.LoginParams) {
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

/**
 * 获取当前用户权限与菜单树信息。
 *
 * @returns 用户资料、角色编码、权限码与菜单树
 */
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

/**
 * 获取行为图形验证码题目。
 *
 * @param data 验证码类型请求参数
 * @param data.captchaType 验证码组件类型标识
 * @returns 验证码底图与滑块挑战载荷
 */
export async function getCaptcha(data: { captchaType: string }) {
  return baseRequestClient.post('/system/captcha/get', data);
}

/**
 * 核验行为图形验证码轨迹。
 *
 * @param data 加密后的轨迹校验票据
 * @param data.captchaVerification 轨迹核验密文字符串
 * @returns 核验通过后的二次校验令牌响应
 */
export async function checkCaptcha(data: { captchaVerification: string }) {
  return baseRequestClient.post('/system/captcha/check', data);
}

/**
 * 发送手机短信验证码。
 *
 * @param data 手机号、业务场景与图形验证码票据
 * @returns 发送受理结果
 */
export async function sendSmsCode(data: AuthApi.SmsCodeParams) {
  return requestClient.post('/system/auth/send-sms-code', data);
}

/**
 * 使用短信验证码登录管理平台。
 *
 * @param data 手机号与短信验证码
 * @returns 访问令牌、刷新令牌与改密状态
 */
export async function smsLogin(data: AuthApi.SmsLoginParams) {
  return requestClient.post<AuthApi.LoginResult>(
    '/system/auth/sms-login',
    data,
  );
}

/**
 * 通过短信验证码重置普通账号密码。
 *
 * @param data 手机号、短信验证码与 SM2 密文新密码
 * @returns 密码重置结果
 */
export async function smsResetPassword(data: AuthApi.ResetPasswordParams) {
  return requestClient.post('/system/auth/reset-password', data);
}

/**
 * 认证、图形验证码、SM2 公钥与短信认证接口。
 */
import type { OpenApiSchemas } from '@/api/generated/api-types';

import { rawHttp, request } from '@/api/request';

export type LoginReq = Omit<OpenApiSchemas.AuthLoginReqVO, 'captchaVerification'> & {
  captchaVerification?: string;
};
export type LoginResp = OpenApiSchemas.AuthLoginRespVO;
export type PermissionInfoResp = OpenApiSchemas.AuthPermissionInfoRespVO;
export type MenuRouteItem = OpenApiSchemas.AuthPermissionInfoRespVO_MenuVO;
export type CurrentUserInfo = OpenApiSchemas.AuthPermissionInfoRespVO_UserVO;
export type Sm2PublicKeyResp = OpenApiSchemas.Sm2PublicKeyRespVO;
export type SmsSendReq = Omit<OpenApiSchemas.AuthSmsSendReqVO, 'captchaVerification'> & {
  captchaVerification?: string;
};
export type SmsLoginReq = OpenApiSchemas.AuthSmsLoginReqVO;
export type ResetPasswordReq = OpenApiSchemas.AuthResetPasswordReqVO;

/** Explicit password-login platform; super admin remains the default entry. */
export type LoginPlatform = 'super' | 'business';

export function loginApi(data: LoginReq, platform: LoginPlatform = 'super') {
  return request.post<LoginResp>(
    platform === 'business' ? '/system/auth/login' : '/system/auth/super-admin-login',
    data,
  );
}

export function logoutApi(accessToken: string) {
  return rawHttp.post(
    '/system/auth/logout',
    {},
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
}

export function getPermissionInfoApi() {
  return request.get<PermissionInfoResp>('/system/auth/get-permission-info');
}

export function getSm2PublicKey() {
  return request.get<Sm2PublicKeyResp>('/system/auth/sm2-public-key');
}

export function getCaptchaApi(data: { captchaType: string }) {
  return rawHttp.post('/system/captcha/get', data);
}

export function checkCaptchaApi(data: {
  captchaType: string;
  pointJson: string;
  token: string;
}) {
  return rawHttp.post('/system/captcha/check', data);
}

export function sendSmsCodeApi(data: SmsSendReq) {
  return request.post<boolean>('/system/auth/send-sms-code', data);
}

export function smsLoginApi(data: SmsLoginReq) {
  return request.post<LoginResp>('/system/auth/sms-login', data);
}

export function resetPasswordBySmsApi(data: ResetPasswordReq) {
  return request.post<boolean>('/system/auth/reset-password', data);
}

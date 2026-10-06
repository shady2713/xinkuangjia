/**
 * 认证界面出口：聚合标题、账号登录、验证码登录、二维码登录、注册、忘记密码、
 * 登录过期弹窗与提示面板，并统一导出 AuthenticationProps 类型。
 * 组件只提供界面与 submit 事件，登录注册等接口调用由 apps 层在回调中完成。
 */
export { default as AuthenticationAuthTitle } from './auth-title.vue';
export { default as AuthenticationCodeLogin } from './code-login.vue';
export { default as DocLink } from './doc-link.vue';
export { default as AuthenticationForgetPassword } from './forget-password.vue';
export { default as AuthenticationLoginExpiredModal } from './login-expired-modal.vue';
export { default as AuthenticationLogin } from './login.vue';
export { default as AuthenticationQrCodeLogin } from './qrcode-login.vue';
export { default as AuthenticationRegister } from './register.vue';
export type { AuthenticationProps } from './types';

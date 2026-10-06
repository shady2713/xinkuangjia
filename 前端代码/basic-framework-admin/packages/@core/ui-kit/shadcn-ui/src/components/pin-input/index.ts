/**
 * 验证码输入出口：暴露 VbenPinInput 并转发其属性契约类型。
 * 供验证码登录、忘记密码等认证表单使用，倒计时逻辑在 input.vue 内。
 */
export { default as VbenPinInput } from './input.vue';

export type * from './types';

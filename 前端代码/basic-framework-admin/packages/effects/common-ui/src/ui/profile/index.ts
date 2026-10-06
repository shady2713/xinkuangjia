/**
 * 个人中心 UI 出口：聚合 Profile 外壳与基础、密码、通知、安全设置组件，
 * 并转发 types 中的 Props、FormSchemaItem、SettingProps。
 *
 * 组件只做展示与取值抛出，资料读写请求由使用方应用自行实现。
 */
export { default as ProfileBaseSetting } from './base-setting.vue';
export { default as ProfileNotificationSetting } from './notification-setting.vue';
export { default as ProfilePasswordSetting } from './password-setting.vue';
export { default as Profile } from './profile.vue';
export { default as ProfileSecuritySetting } from './security-setting.vue';
export type * from './types';

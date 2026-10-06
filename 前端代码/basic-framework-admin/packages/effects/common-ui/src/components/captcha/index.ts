/**
 * 验证码组件统一出口：聚合点选、滑块、旋转、平移四类验证码，
 * 以及按类型分发的 Verification 组件与全部 props、数据契约类型。
 * 取图与校验接口由调用方注入，组件不直接访问后端。
 */
export { default as PointSelectionCaptcha } from './point-selection-captcha/index.vue';
export { default as PointSelectionCaptchaCard } from './point-selection-captcha/index.vue';

export { default as SliderCaptcha } from './slider-captcha/index.vue';
export { default as SliderRotateCaptcha } from './slider-rotate-captcha/index.vue';
export { default as SliderTranslateCaptcha } from './slider-translate-captcha/index.vue';
export type * from './types';

export { default as Verification } from './verification/index.vue';
export type * from './verification/typing';

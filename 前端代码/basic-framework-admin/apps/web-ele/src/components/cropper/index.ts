/**
 * 裁剪组件出口：暴露 CropperAvatar 头像裁剪控件与 CropperImage 裁剪画布，
 * 并转发裁剪器实例类型 CropperType；属性与事件载荷契约在 ./typing。
 */
export { default as CropperAvatar } from './cropper-avatar.vue';
export { default as CropperImage } from './cropper.vue';
export type { CropperType } from './typing';

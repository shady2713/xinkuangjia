/**
 * 头像出口：暴露 Avatar 容器、图片、占位符与 avatarVariant 样式变体。
 * 上层 components 的头像组件在此基础上叠加文字、圆点等业务表现。
 */
export * from './avatar';
export { default as Avatar } from './Avatar.vue';
export { default as AvatarFallback } from './AvatarFallback.vue';
export { default as AvatarImage } from './AvatarImage.vue';

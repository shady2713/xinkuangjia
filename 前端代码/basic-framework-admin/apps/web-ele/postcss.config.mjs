/**
 * 应用 PostCSS 入口：直接转发共享的 Tailwind 预设，不再追加本地插件。
 * 设计变量与暗色主题由该预设统一维护，此处只负责接线。
 */
export { default } from '@vben/tailwind-config/postcss';

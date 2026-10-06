/**
 * 偏好设置的对外出口：暴露触发按钮 PreferencesButton、入口组件 Preferences，
 * 以及 use-open-preferences 的打开状态与句柄。
 * 抽屉内的 blocks 表单行属内部实现，不经此处导出。
 */
export { default as PreferencesButton } from './preferences-button.vue';
export { default as Preferences } from './preferences.vue';
export * from './use-open-preferences';

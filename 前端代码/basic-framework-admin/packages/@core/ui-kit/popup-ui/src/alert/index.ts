/**
 * alert 子模块出口：导出 Alert 组件与 alert、confirm、
 * prompt 三个命令式方法，以及 clearAllAlerts、
 * useAlertContext 与 AlertProps、IconType、
 * PromptProps、BeforeCloseScope 等类型。
 */
export type {
  AlertProps,
  BeforeCloseScope,
  IconType,
  PromptProps,
} from './alert';
export { useAlertContext } from './alert';
export { default as Alert } from './alert.vue';
export {
  vbenAlert as alert,
  clearAllAlerts,
  vbenConfirm as confirm,
  vbenPrompt as prompt,
} from './AlertBuilder';

/**
 * 通知模块出口：导出 Notification 弹窗组件，并转出 NotificationItem 数据契约。
 * 组件只负责列表展示与已读、删除、跳转交互，未读数量与消息拉取由调用方维护。
 */
export { default as Notification } from './notification.vue';

export type * from './types';

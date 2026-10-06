/**
 * 锁屏模块出口：导出 LockScreen 全屏遮罩与 LockScreenModal 解锁弹窗。
 * 遮罩由基础布局在锁屏状态下挂载，弹窗由用户下拉菜单触发；
 * 两者共用访问令牌中的锁屏密码，解锁状态本身由 stores 维护。
 */
export { default as LockScreenModal } from './lock-screen-modal.vue';
export { default as LockScreen } from './lock-screen.vue';

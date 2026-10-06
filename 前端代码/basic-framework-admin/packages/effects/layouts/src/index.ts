/**
 * 布局包总出口：聚合登录页、基础布局、内嵌页与挂件四组能力。
 * 布局类导出 BasicLayout 与 AuthPageLayout，
 * 内嵌页与挂件导出 IFrameView 等能力，应用层统一从这里导入。
 */
export * from './authentication';
export * from './basic';
export * from './iframe';
export * from './widgets';

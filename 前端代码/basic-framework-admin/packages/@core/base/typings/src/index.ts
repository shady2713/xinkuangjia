/**
 * typings 包的类型聚合出口：整体再导出六个声明文件。
 * 聚合 app、basic、helper 三组基础类型，
 * 以及 menu-record、tabs、vue-router 三组业务类型。
 * 只含类型声明不含运行时实现；新增对外类型须登记到此。
 */
export type * from './app';
export type * from './basic';
export type * from './helper';
export type * from './menu-record';
export type * from './tabs';
export type * from './vue-router';

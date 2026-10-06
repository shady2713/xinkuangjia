/**
 * 应用类型出口：转发本工程的 ./user 用户与权限类型，并再导出 @vben-core/typings 的基础类型。
 * 全部为纯类型导出，不产生运行时代码。
 */
export type * from './user';
export type * from '@vben-core/typings';

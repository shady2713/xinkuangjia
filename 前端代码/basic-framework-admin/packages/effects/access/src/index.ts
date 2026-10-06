/**
 * 权限模块的统一出口：聚合权限组件、动态路由生成、
 * 权限指令与 useAccess 组合式函数，供应用层按需引入。
 * 本文件只做转发，权限判定与路由生成实现分散在各自文件。
 */
export { default as AccessControl } from './access-control.vue';
export * from './accessible';
export * from './directive';
export * from './use-access';

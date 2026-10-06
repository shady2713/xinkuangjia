/**
 * 描述列表出口：暴露 Description 组件、useDescription 工厂与全部 schema 类型。
 * 详情页用 useDescription 声明式渲染键值对；
 * 取值与插槽规则在 ./typing 与 description.vue，本文件只做转发。
 */
export { default as Description } from './description.vue';
export * from './typing';
export { useDescription } from './use-description';

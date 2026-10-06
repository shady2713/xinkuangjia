/**
 * 操作日志出口：暴露时间线组件 OperateLog 与入参类型 OperateLogProps。
 * 供日志详情等场景嵌入展示；查询、分页与导出接口由 api/system/operate-log 提供。
 */
export { default as OperateLog } from './operate-log.vue';

export type { OperateLogProps } from './typing';

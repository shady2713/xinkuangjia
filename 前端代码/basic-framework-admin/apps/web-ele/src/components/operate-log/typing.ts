/**
 * 操作日志组件的属性契约：日志行类型复用 system/operate-log 接口定义。
 * 只声明 logList 一个入参，分页、筛选与请求发起由使用该组件的页面负责。
 */
import type { SystemOperateLogApi } from '#/api/system/operate-log';

export interface OperateLogProps {
  logList: SystemOperateLogApi.OperateLog[]; // 操作日志列表
}

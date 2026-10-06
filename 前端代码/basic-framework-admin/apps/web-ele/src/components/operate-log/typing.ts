/**
 * 操作日志组件的属性契约：日志行类型复用 system/operate-log 接口定义。
 * 只声明 logList 一个入参，分页、筛选与请求发起由使用该组件的页面负责。
 */
import type { SystemOperateLogApi } from '#/api/system/operate-log';

/** 操作日志列表的入参：只接收已查好的日志行，分页与筛选由调用页面负责。 */
export interface OperateLogProps {
  logList: SystemOperateLogApi.OperateLog[]; // 操作日志列表
}

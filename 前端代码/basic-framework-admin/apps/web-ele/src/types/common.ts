/**
 * 通用类型声明：提供导出参数、树节点与数据库表查询三类共享契约。
 *
 * 本文件不产生运行时代码，当前工程内暂无引用方；
 * 具体业务实体的类型定义在各业务模块内，不集中到这里。
 */
import type { PageParam } from '@vben/request';

/** 通用导出参数，继承分页参数 */
export type ExportParams = PageParam;

/** 通用树节点数据结构 */
export interface TreeNodeData {
  id: number;
  label?: string;
  name?: string;
  children?: TreeNodeData[];
}

/** 数据库表查询参数 */
export interface DatabaseTableQueryParams {
  dataSourceConfigId?: number;
  name?: string;
  comment?: string;
}

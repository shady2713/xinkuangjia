import type {
  VxeGridListeners,
  VxeGridPropTypes,
  VxeGridProps as VxeTableGridProps,
  VxeUIExport,
} from 'vxe-table';

import type { Ref } from 'vue';

import type { ClassType, DeepPartial } from '@vben/types';

import type { BaseFormComponentType, VbenFormProps } from '@vben-core/form-ui';

import type { VxeGridApi } from './api';

import { useVbenForm } from '@vben-core/form-ui';

export interface VxePaginationInfo {
  currentPage: number;
  pageSize: number;
  total: number;
}

interface ToolbarConfigOptions extends VxeGridPropTypes.ToolbarConfig {
  /** 是否显示切换搜索表单的按钮 */
  search?: boolean;
}

/**
 * 表格行数据的兜底类型。
 * 调用方没有声明行类型时用它占位；此时行字段只能通过 vxe 的运行时取值接口访问，
 * 需要具体字段的场景必须显式传入行类型。
 */
type DefaultRowData = Record<string, unknown>;

/**
 * vxe-grid 的配置项：在 vxe-table 原生配置基础上补充本项目的工具栏搜索开关。
 * @typeParam T 表格行类型；不指定时按 DefaultRowData 占位。
 */
export interface VxeTableGridOptions<
  T = DefaultRowData,
> extends VxeTableGridProps<T> {
  /** 工具栏配置 */
  toolbarConfig?: ToolbarConfigOptions;
}

export interface SeparatorOptions {
  show?: boolean;
  backgroundColor?: string;
}

/**
 * VbenVxeGrid 组件的属性契约：把表格配置、事件、搜索表单与标题区一次性描述完整。
 * @typeParam T 表格行类型。
 * @typeParam D 表单组件类型，决定搜索表单可用的控件集合。
 */
export interface VxeGridProps<
  T extends object = DefaultRowData,
  D extends BaseFormComponentType = BaseFormComponentType,
> {
  /**
   * 标题
   */
  tableTitle?: string;
  /**
   * 标题帮助
   */
  tableTitleHelp?: string;
  /**
   * 组件class
   */
  class?: ClassType;
  /**
   * vxe-grid class
   */
  gridClass?: ClassType;
  /**
   * vxe-grid 配置
   */
  gridOptions?: DeepPartial<VxeTableGridOptions<T>>;
  /**
   * vxe-grid 事件
   */
  gridEvents?: DeepPartial<VxeGridListeners<T>>;
  /**
   * 表单配置
   */
  formOptions?: VbenFormProps<D>;
  /**
   * 显示搜索表单
   */
  showSearchForm?: boolean;
  /**
   * 搜索表单与表格主体之间的分隔条
   */
  separator?: boolean | SeparatorOptions;
}

/**
 * 表格状态选择器：从表格状态中挑选出调用方关心的数据，不传则取整个状态。
 * 入参按未指定行类型的状态暴露，因为使用方通常只取分页、加载态这类与行数据无关的字段。
 * @typeParam T 挑选结果的类型，由使用方自行推断。
 */
type VxeStateSelector<T> = (
  state: NoInfer<VxeGridProps<DefaultRowData, BaseFormComponentType>>,
) => T;

export type ExtendedVxeGridApi<
  D extends object = DefaultRowData,
  F extends BaseFormComponentType = BaseFormComponentType,
> = {
  /**
   * 以响应式只读形式读取表格内部状态。
   * selector 用于从状态中挑选需要的数据，不传时返回整个状态。
   */
  useStore: <T = NoInfer<VxeGridProps<D, F>>>(
    selector?: VxeStateSelector<T>,
  ) => Readonly<Ref<T>>;
} & VxeGridApi<D>;

export interface SetupVxeTable {
  configVxeTable: (ui: VxeUIExport) => void;
  useVbenForm: typeof useVbenForm;
}

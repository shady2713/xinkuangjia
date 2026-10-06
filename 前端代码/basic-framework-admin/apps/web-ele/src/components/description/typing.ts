/**
 * 描述列表的渲染契约：DescriptionItemSchema 描述字段标签、取值路径与渲染方式，
 * DescriptionProps 在 ElDescriptions 属性上追加 schema 与 data，
 * DescInstance 是外部改属性的句柄；取值与样式实现不在本文件。
 */
import type { DescriptionProps as ElDescriptionProps } from 'element-plus';
import type { JSX } from 'vue/jsx-runtime';

import type { CSSProperties, VNode } from 'vue';

import type { Recordable } from '@vben/types';

/**
 * 单个描述项的渲染配置：字段取值的字段名、标签文本、跨列数，
 * 以及按字段定制内容的 render / show 与替换默认渲染的 slot。
 * 各项配置是独立的可选覆盖，不传时由 description.vue 的默认取值逻辑兜底。
 */
export interface DescriptionItemSchema {
  labelMinWidth?: number;
  contentMinWidth?: number;
  labelStyle?: CSSProperties; // 自定义标签样式
  field: string; // 对应 data 中的字段名
  label: JSX.Element | string | VNode; // 内容的描述
  span?: number; // 包含列的数量
  show?: (...arg: unknown[]) => boolean; // 是否显示
  slot?: string; // 插槽名称
  render?: (
    val: unknown,
    data?: Recordable<unknown>,
  ) => Element | JSX.Element | number | string | undefined | VNode; // 自定义需要展示的内容
}

/**
 * 描述列表组件的对外属性：在 ElDescriptions 自带的边框、列数、方向等属性之上，
 * 追加决定渲染内容的 schema 与被取值的 data，两者缺一都会导致列表空白。
 */
export interface DescriptionProps extends ElDescriptionProps {
  schema: DescriptionItemSchema[]; // 描述项配置
  data: Recordable<unknown>; // 数据
}

/**
 * 描述列表的操作句柄：useDescription 返回它，让调用方在异步取数完成后
 * 就地覆盖属性，无需重新挂载组件。
 */
export interface DescInstance {
  /**
   * 合并覆盖描述列表属性，同名字段被新值替换、未提及的字段保持原值。
   * @param descProps 需要覆盖的属性片段，通常是异步取数得到的 schema 与 data。
   */
  setDescProps(descProps: Partial<DescriptionProps>): void;
}

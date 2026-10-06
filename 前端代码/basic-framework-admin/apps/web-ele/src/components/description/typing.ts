/**
 * 描述列表的渲染契约：DescriptionItemSchema 描述字段标签、取值路径与渲染方式，
 * DescriptionProps 在 ElDescriptions 属性上追加 schema 与 data，
 * DescInstance 是外部改属性的句柄；取值与样式实现不在本文件。
 */
import type { DescriptionProps as ElDescriptionProps } from 'element-plus';
import type { JSX } from 'vue/jsx-runtime';

import type { CSSProperties, VNode } from 'vue';

import type { Recordable } from '@vben/types';

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

export interface DescriptionProps extends ElDescriptionProps {
  schema: DescriptionItemSchema[]; // 描述项配置
  data: Recordable<unknown>; // 数据
}

export interface DescInstance {
  setDescProps(descProps: Partial<DescriptionProps>): void;
}

/**
 * 表单渲染上下文：向字段子树下发渲染属性与组件映射。
 * 由 form.vue 提供，字段组件据此取布局、控件表与绑定事件名；
 * 不持有表单状态，读写仍走 use-form-context 里的实例。
 */
import type { FormRenderProps } from '../types';

import { computed } from 'vue';

import { createContext } from '@vben-core/shadcn-ui';

/** 表单渲染属性的注入/提供对：form.vue 提供，各字段组件据此取控件表与绑定事件名。 */
export const [injectRenderFormProps, provideFormRenderProps] =
  createContext<FormRenderProps>('FormRenderProps');

/**
 * 字段组件读取渲染属性的入口，只做一次 inject 再拆成响应式引用，
 * 让字段模板不必重复解包响应式对象。
 * @returns 布局方向、控件表与控件绑定事件名三个计算属性，均随渲染属性变化实时更新。
 */
export const useFormContext = () => {
  const formRenderProps = injectRenderFormProps();

  /** 是否为纵向布局：决定标签与控件是上下排列还是同行对齐。 */
  const isVertical = computed(() => formRenderProps.layout === 'vertical');

  /** schema 中控件名到组件定义的映射表，随适配层注册结果变化。 */
  const componentMap = computed(() => formRenderProps.componentMap);

  /** 需要改用非默认取值属性名的控件清单；大部分控件在此没有登记项。 */
  const componentBindEventMap = computed(
    () => formRenderProps.componentBindEventMap,
  );
  return {
    componentBindEventMap,
    componentMap,
    isVertical,
  };
};

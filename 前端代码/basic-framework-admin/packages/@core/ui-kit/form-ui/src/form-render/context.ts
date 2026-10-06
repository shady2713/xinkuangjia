/**
 * 表单渲染上下文：向字段子树下发渲染属性与组件映射。
 * 由 form.vue 提供，字段组件据此取布局、控件表与绑定事件名；
 * 不持有表单状态，读写仍走 use-form-context 里的实例。
 */
import type { FormRenderProps } from '../types';

import { computed } from 'vue';

import { createContext } from '@vben-core/shadcn-ui';

export const [injectRenderFormProps, provideFormRenderProps] =
  createContext<FormRenderProps>('FormRenderProps');

export const useFormContext = () => {
  const formRenderProps = injectRenderFormProps();

  const isVertical = computed(() => formRenderProps.layout === 'vertical');

  const componentMap = computed(() => formRenderProps.componentMap);
  const componentBindEventMap = computed(
    () => formRenderProps.componentBindEventMap,
  );
  return {
    componentBindEventMap,
    componentMap,
    isVertical,
  };
};

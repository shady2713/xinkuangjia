import type { Component } from 'vue';

import type { DescInstance, DescriptionProps } from './typing';

import { h, reactive } from 'vue';

import Description from './description.vue';

/**
 * 创建一个带响应式属性状态的描述列表组件。
 * @param options 初始描述属性，后续可通过返回的实例覆盖。
 * @returns 描述列表组件与其操作实例的只读元组。
 */
export function useDescription(options?: Partial<DescriptionProps>) {
  const propsState = reactive<Partial<DescriptionProps>>(options || {});

  const api: DescInstance = {
    setDescProps: (descProps: Partial<DescriptionProps>): void => {
      Object.assign(propsState, descProps);
    },
  };

  // 创建一个包装组件，将 propsState 合并到 props 中
  const DescriptionWrapper: Component = {
    name: 'UseDescription',
    inheritAttrs: false,
    /**
     * 渲染包装组件：把属性状态与透传属性合并后交给描述列表。
     * @param _props 组件入参，此处不直接使用，实际取值来自属性状态。
     * @param context 组件上下文。
     * @param context.attrs 透传到描述列表的属性。
     * @param context.slots 透传到描述列表的插槽。
     * @returns 渲染描述列表的函数。
     */
    setup(_props, { attrs, slots }) {
      return (
        /**
         * 产出描述列表的虚拟节点。
         * @returns 描述列表虚拟节点。
         */
        () => {
          // 描述组件的属性面很大，而这里要把动态属性包与 attrs 合并后一次性传入；
          // 按不透明组件渲染可以避开 h() 对该 SFC 做过深的属性实例化，
          // 与 use-form 中渲染层 SFC 的处理方式一致。
          return h(
            Description as Component,
            { ...propsState, ...attrs },
            slots,
          );
        }
      );
    },
  };

  return [DescriptionWrapper, api] as const;
}

/**
 * 表单组件的创建入口：把表单属性收敛成组件与操作实例，
 * 组件负责渲染，实例负责挂载等待、读写与提交，两者共享同一份值类型。
 */
import type { Component } from 'vue';

import type {
  BaseFormComponentType,
  ExtendedFormApi,
  FormValues,
  FormValuesConstraint,
  VbenFormProps,
} from './types';

import { defineComponent, h, isReactive, onBeforeUnmount, watch } from 'vue';

import { useStore } from '@vben-core/shared/store';

import { FormApi } from './form-api';
import VbenUseForm from './use-form-renderer.vue';

/**
 * 状态选择器：从表单状态中挑选需要响应的部分。
 * @param state 当前表单状态。
 * @returns 需要订阅的响应式结果。
 */
type FormStateSelector<
  T extends BaseFormComponentType,
  TValues extends FormValuesConstraint,
  R,
> = (state: VbenFormProps<T, TValues>) => R;

/**
 * 创建表单组件与其操作实例。
 * @param options 表单属性；`handleSubmit`、`handleValuesChange` 的入参会按 `TValues` 收窄。
 * @returns `[Form, formApi]`，其中 `formApi.getValues()` 返回 `Promise<TValues>`。
 *
 * @example
 * ```ts
 * const [Form, formApi] = useVbenForm<ComponentType, InfraConfigApi.Config>({ ... });
 * const config = await formApi.getValues(); // 已是 InfraConfigApi.Config，无需断言
 * ```
 */
export function useVbenForm<
  T extends BaseFormComponentType = BaseFormComponentType,
  TValues extends FormValuesConstraint = FormValues,
>(options: VbenFormProps<T, TValues>) {
  const IS_REACTIVE = isReactive(options);
  const api = new FormApi<TValues, T>(options);
  // `useStore` 是消费侧附加能力，运行时直接挂到真实实例上；
  // 用 Object.assign 补齐类型，避免把整个实例断言成 never。
  const extendedApi: ExtendedFormApi<TValues, T> = Object.assign(api, {
    /**
     * 订阅表单状态，供消费组件响应式读取配置。
     * @param selector 需要响应的状态切片；缺省时返回整个状态。
     * @returns 只读响应式结果。
     */
    useStore: <R = VbenFormProps<T, TValues>>(
      selector?: FormStateSelector<T, TValues, R>,
    ) => useStore(api.store, selector),
  });

  const Form = defineComponent(
    /**
     * 表单组件本体：把 props 与透传 attrs 合并进实例状态后交给渲染层。
     * @param props 调用方声明的表单属性。
     * @param props.attrs 调用方透传的非声明属性，交给渲染层决定落到哪个节点。
     * @param props.slots 调用方传入的具名插槽，原样透传给渲染层。
     * @returns 渲染函数，返回真实渲染组件的虚拟节点。
     */
    (props: VbenFormProps<T, TValues>, { attrs, slots }) => {
      onBeforeUnmount(() => {
        api.unmount();
      });
      api.setState({ ...props, ...attrs });
      return (
        /**
         * 渲染层是 SFC，无法在 h() 上表达“带任意值类型的 formApi 属性”，
         * 这里按动态组件渲染，运行时传入的就是上面的真实实例。
         */
        () =>
          h(
            VbenUseForm as Component,
            { ...props, ...attrs, formApi: extendedApi },
            slots,
          )
      );
    },
    {
      name: 'VbenUseForm',
      inheritAttrs: false,
    },
  );
  // Add reactivity support
  if (IS_REACTIVE) {
    watch(
      () => options.schema,
      () => {
        api.setState({ schema: options.schema });
      },
      { immediate: true },
    );
  }

  return [Form, extendedApi] as const;
}

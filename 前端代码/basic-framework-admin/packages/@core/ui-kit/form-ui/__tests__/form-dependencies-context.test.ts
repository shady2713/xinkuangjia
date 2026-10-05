/**
 * 表单项联动状态机的上下文契约（form-render/dependencies）真实行为回归。
 *
 * 联动状态机读取表单值后有一处空值守卫。真实 vee-validate 的 `useFormValues` 在没有表单
 * 上下文时仍然返回一个空值引用，因此该守卫在真实链路上不会被触发：本用例用真实调用把这
 * 条契约固定下来 —— 只提供渲染上下文、没有任何表单时，`useDependencies` 仍然返回可用的
 * 联动状态，全部是安全默认值，字段不会因为缺少表单上下文而抛错。这同时是「空值守卫不可达」
 * 结论（对应未覆盖行 59-60，已如实上报）的实测证据。
 */
import type { FormRenderProps } from '../src/types';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { provideFormRenderProps } from '../src/form-render/context';
import useDependencies from '../src/form-render/dependencies';

/** 联动状态机的返回结果，用例逐项读取它的响应式引用。 */
type DependencyState = ReturnType<typeof useDependencies>;

/** 承载最近一次挂载得到的联动状态，缺上下文时保持 undefined。 */
const holder: { state?: DependencyState } = {};

/**
 * 联动状态消费方：只依赖渲染上下文，不建立任何 vee-validate 表单。
 */
const ConsumerHost = defineComponent({
  name: 'ConsumerHost',
  /**
   * 在缺少表单上下文时建立联动状态机。
   * @returns 渲染最小宿主节点的渲染函数。
   */
  setup() {
    holder.state = useDependencies(
      /** 本用例的字段没有任何联动声明，联动状态应保持默认值。 */ () =>
        undefined,
    );
    return /** 渲染最小宿主节点，联动状态通过模块变量读取。 */ () =>
      h('div', { 'data-test': 'consumer-host' });
  },
});

/**
 * 渲染上下文提供方：与真实表单容器一样只向下提供 FormRenderProps。
 */
const ProviderHost = defineComponent({
  name: 'ProviderHost',
  /**
   * 提供渲染上下文并渲染消费方。
   * @returns 渲染消费方组件的渲染函数。
   */
  setup() {
    provideFormRenderProps({ form: undefined } as unknown as FormRenderProps);
    return /** 渲染消费方组件，上下文经由 provide/inject 传递。 */ () =>
      h(ConsumerHost);
  },
});

describe('联动状态机的上下文契约', /** 缺少表单上下文时字段不能整体抛错，只能拿到安全默认状态。 */ () => {
  it('没有表单上下文时联动状态全部是安全默认值', /** 抛错会让表单项整体渲染失败，默认值错误会让字段错误隐藏或误禁用。 */ () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 静默 vee-validate 预期内的缺失表单告警，避免污染测试输出。 */ () => {},
      );

    const wrapper = mount(ProviderHost);

    // vee-validate 明确报告没有表单上下文，说明本用例确实走在守卫之前的真实路径上。
    expect(consoleWarn).toHaveBeenCalled();
    expect(holder.state?.isIf.value).toBe(true);
    expect(holder.state?.isShow.value).toBe(true);
    expect(holder.state?.isDisabled.value).toBe(false);
    expect(holder.state?.isRequired.value).toBe(false);
    expect(holder.state?.dynamicRules.value).toBeUndefined();
    expect(holder.state?.dynamicComponentProps.value).toEqual({});

    consoleWarn.mockRestore();
    wrapper.unmount();
  });
});

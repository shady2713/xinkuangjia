/**
 * 表单项联动状态机的表单值上下文缺失契约（form-render/dependencies）真实行为回归。
 *
 * 联动状态机在读取表单值后有一处上下文守卫：拿不到表单值时必须立刻抛出，说明该状态机
 * 被用在了 `<VbenForm>` 之外。真实 vee-validate 的 `useFormValues` 在没有表单上下文时
 * 仍返回一个空值引用，所以真实链路上永远不会交出空值 —— 本用例把这条边界用受控替身
 * 显式构造出来：让 `useFormValues` 交出 undefined，再断言 `useDependencies` 抛出约定文案。
 * 守卫缺失会让状态机在没有表单上下文时继续运行，联动结果写回一个不存在的表单，
 * 页面既不报错也不生效，问题只能在运行期靠猜。
 *
 * 注意：受控替身只替换"表单值上下文"这一外部边界，注入上下文与组件挂载仍走真实实现。
 */
import type { FormRenderProps } from '../src/types';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { provideFormRenderProps } from '../src/form-render/context';
import useDependencies from '../src/form-render/dependencies';

vi.mock(
  'vee-validate',
  /**
   * 只把表单值上下文替换为"拿不到值"的边界：返回 undefined 表示当前不在表单内。
   * 其余导出与本用例无关，不需要提供。
   */ () => ({
    /** 模拟不在 `<VbenForm>` 内时拿不到表单值引用。 */
    useFormValues: () => undefined,
  }),
);

/** 守卫抛出的错误文案，缺失上下文时必须一字不差地给出。 */
const CONTEXT_ERROR = 'useDependencies should be used within <VbenForm>';

/** 承载 setup 期间捕获到的抛出物。 */
const captured: { error?: unknown } = {};

/**
 * 联动状态消费方：在只提供渲染上下文、没有任何表单的环境里建立状态机。
 */
const ConsumerHost = defineComponent({
  name: 'MissingContextConsumer',
  /**
   * 尝试建立联动状态机并把抛出物记录下来，避免 Vue 的 setup 错误处理改写错误形态。
   * @returns 渲染最小宿主节点的渲染函数。
   */
  setup() {
    try {
      useDependencies(
        /** 本用例的字段没有任何联动声明，是否抛错只取决于表单值上下文。 */ () =>
          undefined,
      );
    } catch (error) {
      captured.error = error;
    }
    return /** 渲染最小宿主节点，结果通过模块变量读取。 */ () =>
      h('div', { 'data-test': 'missing-context-consumer' });
  },
});

/**
 * 渲染上下文提供方：与真实表单容器一样只向下提供 FormRenderProps。
 */
const ProviderHost = defineComponent({
  name: 'MissingContextProvider',
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

describe('联动状态机的表单值上下文守卫', /** 拿不到表单值必须立刻失败，否则联动结果会静默写入不存在的表单。 */ () => {
  it('拿不到表单值引用时抛出上下文错误', /** 守卫缺失会让状态机在没有表单时继续运行，联动彻底失效且不报错。 */ () => {
    captured.error = undefined;

    const wrapper = mount(ProviderHost);

    expect(
      wrapper.find('[data-test="missing-context-consumer"]').exists(),
    ).toBe(true);
    expect(captured.error).toBeInstanceOf(Error);
    expect((captured.error as Error).message).toBe(CONTEXT_ERROR);
  });
});

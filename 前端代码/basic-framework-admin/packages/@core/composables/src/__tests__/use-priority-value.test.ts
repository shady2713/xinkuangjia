/**
 * usePriorityValue / usePriorityValues 的来源优先级与创建期上下文快照测试。
 *
 * 回归点是求值时机：computed getter 惰性求值，首次读取通常发生在 DOM 事件回调里，
 * 那时 Vue 已经没有 active instance。修复前 getter 内部调用 getCurrentInstance/useSlots/useAttrs，
 * 会抛出 `useSlots() called without active instance` 或读取 null 的 setupContext。
 * 因此这里不直接调用内部函数，而是真实挂载消费组件、通过点击触发读取。
 */
import type { Ref } from 'vue';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { describe, expect, it } from 'vitest';

import { usePriorityValue, usePriorityValues } from '../use-priority-value';

/** 消费组件声明的 props：title 是声明 prop，subtitle 故意不声明以便落在 attrs 上。 */
const HARNESS_PROPS = {
  title: { default: undefined, type: String },
} as const;

/**
 * 构造真实挂载的消费组件。
 * @description setup 内创建优先级 computed，只在 DOM 事件回调里读取，
 * 复现弹窗 Escape、焦点、点击外部回调的调用时机；观察值通过外部数组回传，
 * 避免依赖组件实例代理暴露内部状态。
 * @param props 传给 composable 的 props 对象，键集合决定生成哪些 computed。
 * @param state 外部状态引用，用于验证状态更新后的重新解析。
 * @param observed 事件回调读取到的值，按点击顺序记录。
 * @param key 事件回调里读取的字段名。
 * @returns 可挂载的消费组件。
 */
function createHarness(
  props: Record<string, unknown>,
  state: Ref<Record<string, unknown>>,
  observed: unknown[],
  key: string,
) {
  return defineComponent({
    name: 'PriorityValueHarness',
    props: HARNESS_PROPS,
    /**
     * 在 setup 内创建优先级 computed，并把读取动作交给 DOM 事件回调。
     * @returns 渲染按钮的渲染函数，按钮点击时读取一次字段值。
     */
    setup() {
      const values = usePriorityValues(props, state);
      /** DOM 事件回调：此时没有 active instance，回归点就在这一行。 */
      const handleClick = () => {
        observed.push(values[key]?.value);
      };
      /** 渲染只用于触发事件回调的按钮。 */
      const renderButton = () => h('button', { onClick: handleClick }, 'read');
      return renderButton;
    },
  });
}

/**
 * 点击按钮触发一次事件回调内的读取。
 * @param wrapper 已挂载的消费组件包装器。
 * @param observed 事件回调读取到的值，调用前会被清空。
 * @returns 本次事件回调读到的值。
 */
async function readInHandler(
  wrapper: ReturnType<typeof mount>,
  observed: unknown[],
) {
  observed.length = 0;
  await wrapper.find('button').trigger('click');
  return observed[0];
}

describe('usePriorityValue 求值时机', /** 覆盖来源优先级与"事件回调内读取"这一回归点。 */ () => {
  it('在 setup 之外创建时按 state 解析且不抛错', /** 无 active instance 时不能抛 TypeError。 */ () => {
    const state = ref<Record<string, unknown>>({ title: 'state-value' });

    // 没有 active instance：修复前 useSlots() 会直接抛出，修复后按无插槽、无 attrs 处理。
    const value = usePriorityValue(
      'title',
      { title: 'prop-value' },
      state as never,
    );

    expect(value.value).toBe('state-value');
  });

  it('事件回调里读取 props 值时优先于 state', /** 显式传入的 props 必须压过 state 回退值。 */ async () => {
    const observed: unknown[] = [];
    const state = ref<Record<string, unknown>>({ title: 'state-value' });
    const Harness = createHarness(
      { title: 'composable-prop' },
      state,
      observed,
      'title',
    );

    const wrapper = mount(Harness, { props: { title: 'passed' } });

    expect(await readInHandler(wrapper, observed)).toBe('composable-prop');
  });

  it('事件回调里读取 state 值时不抛错', /** 只有 state 有值时也必须能读到。 */ async () => {
    const observed: unknown[] = [];
    const state = ref<Record<string, unknown>>({ title: 'state-value' });
    const Harness = createHarness(
      { title: 'composable-prop' },
      state,
      observed,
      'title',
    );

    const wrapper = mount(Harness);

    expect(await readInHandler(wrapper, observed)).toBe('state-value');
  });

  it('attrs 优先于 props 与 state', /** attrs 是第二优先级来源。 */ async () => {
    const observed: unknown[] = [];
    const state = ref<Record<string, unknown>>({ subtitle: 'state-value' });
    const Harness = createHarness(
      { subtitle: 'composable-prop' },
      state,
      observed,
      'subtitle',
    );

    const wrapper = mount(Harness, { attrs: { subtitle: 'attr-value' } });

    expect(await readInHandler(wrapper, observed)).toBe('attr-value');
  });

  it('插槽优先于 attrs、props 与 state', /** 插槽是最高优先级来源。 */ async () => {
    const observed: unknown[] = [];
    const state = ref<Record<string, unknown>>({ subtitle: 'state-value' });
    const Harness = createHarness(
      { subtitle: 'composable-prop' },
      state,
      observed,
      'subtitle',
    );

    /** 提供最高优先级的插槽来源。 */
    const slotValue = () => 'slot-value';
    const wrapper = mount(Harness, {
      attrs: { subtitle: 'attr-value' },
      slots: { subtitle: slotValue },
    });

    // 插槽分支按契约返回插槽函数本身，消费方据此判断"外部传了插槽"。
    expect(typeof (await readInHandler(wrapper, observed))).toBe('function');
  });

  it('state 更新后事件回调读到新值', /** state 变化必须让 computed 失效并重新解析。 */ async () => {
    const observed: unknown[] = [];
    const state = ref<Record<string, unknown>>({ title: 'before' });
    const Harness = createHarness(
      { title: 'composable-prop' },
      state,
      observed,
      'title',
    );

    const wrapper = mount(Harness);
    expect(await readInHandler(wrapper, observed)).toBe('before');

    state.value = { title: 'after' };
    await nextTick();

    expect(await readInHandler(wrapper, observed)).toBe('after');
  });

  it('attrs 更新后事件回调读到新值', /** attrs 变化同样必须让 computed 失效。 */ async () => {
    const observed: unknown[] = [];
    const state = ref<Record<string, unknown>>({ subtitle: 'state-value' });
    const Harness = createHarness(
      { subtitle: 'composable-prop' },
      state,
      observed,
      'subtitle',
    );
    const attrValue = ref('first-attr');
    // 未声明的键只能由父组件重新渲染来更新 attrs，setProps 不会写入 attrs。
    const Parent = defineComponent({
      name: 'PriorityValueAttrParent',
      /**
       * 把动态 attrs 透传给消费组件。
       * @returns 渲染消费组件的渲染函数。
       */
      setup() {
        /** 把当前动态 attrs 透传给消费组件。 */
        const renderHarness = () => h(Harness, { subtitle: attrValue.value });
        return renderHarness;
      },
    });

    const wrapper = mount(Parent);
    expect(await readInHandler(wrapper, observed)).toBe('first-attr');

    attrValue.value = 'second-attr';
    await nextTick();

    expect(await readInHandler(wrapper, observed)).toBe('second-attr');
  });

  it('同一批 computed 在事件回调中逐个读取都保持各自来源', /** 批量创建时各字段不能串值。 */ async () => {
    const observed: unknown[] = [];
    const state = ref<Record<string, unknown>>({
      subtitle: 'state-subtitle',
      title: 'state-title',
    });
    const Harness = defineComponent({
      name: 'PriorityValueBatchHarness',
      props: HARNESS_PROPS,
      /**
       * 一次回调里读取两个字段，验证各字段的来源互不影响。
       * @returns 渲染按钮的渲染函数。
       */
      setup() {
        const values = usePriorityValues(
          { subtitle: 'prop-subtitle', title: 'prop-title' },
          state,
        );
        /** 依次读取两个字段，读取顺序与断言顺序一致。 */
        const handleClick = () => {
          observed.push(values.subtitle?.value, values.title?.value);
        };
        /** 渲染只用于触发事件回调的按钮。 */
        const renderButton = () =>
          h('button', { onClick: handleClick }, 'read');
        return renderButton;
      },
    });

    const wrapper = mount(Harness, {
      attrs: { subtitle: 'attr-subtitle' },
      props: { title: 'passed-title' },
    });

    observed.length = 0;
    await wrapper.find('button').trigger('click');

    expect(observed).toEqual(['attr-subtitle', 'prop-title']);
  });
});

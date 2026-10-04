/**
 * 表单项联动（useDependencies）各分支的真实行为回归。
 *
 * 覆盖联动声明的全部取值形态：布尔 if/show/disabled、函数形态的 show、componentProps、
 * rules、disabled、required 与 trigger，以及 vee-validate 的 `[字段]` 触发字段写法。
 * 断言读取真实渲染结果（控件禁用、隐藏、必填标记、动态参数）与联动回调的入参。
 */
import type { Component } from 'vue';

import type { BaseFormComponentType } from '../src/types';

import { flushPromises, mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { useVbenForm } from '../src/use-form';

/** 联动用例的业务值形状。 */
type DependencyValues = {
  bracket: string;
  fnDisabled: string;
  fnShown: string;
  mode: string;
  plainDisabled: string;
  plainShown: string;
  requiredFn: string;
  rulesFn: string;
  shown: string;
  triggerFn: string;
};

/** 已挂载组件中可等待 DOM 更新的最小接口。 */
type MountedLike = {
  vm: {
    /** 等待一次渲染与异步队列结算。 */
    $nextTick: () => Promise<void>;
  };
};

/**
 * 冲刷挂载后建立的联动监听与异步回调。
 * 联动回调在 await 之后写回响应式状态，只等一次 tick 不足以让 DOM 收敛。
 * @param wrapper 已挂载的组件包装器。
 * @returns 冲刷完成后兑现的 Promise。
 */
async function flush(wrapper: MountedLike) {
  await flushPromises();
  await wrapper.vm.$nextTick();
  await flushPromises();
}

/**
 * 挂载真实表单组件并等待挂载期的联动回调结算。
 * @param options 表单属性，与 useVbenForm 的入参一致。
 * @returns 表单操作实例与组件包装器。
 */
async function mountForm(options: Parameters<typeof useVbenForm>[0]) {
  const [Form, formApi] = useVbenForm<BaseFormComponentType, DependencyValues>(
    options,
  );
  const wrapper = mount(Form as Component);
  await flush(wrapper);
  return { formApi, wrapper };
}

/**
 * 读取承载 v-show 的表单项容器的内联样式。
 * 联动隐藏落在表单项容器上，控件本身不带 display，因此需要向上找到带 display 的节点。
 * @param wrapper 已挂载的组件包装器。
 * @param fieldName 目标字段名。
 * @returns 该表单项容器的 style 文本；该表单项没有内联样式时返回空字符串。
 */
function fieldItemStyle(
  wrapper: ReturnType<typeof mount>,
  fieldName: string,
): string {
  let node: Element | null = wrapper.find(`input[name="${fieldName}"]`).element;
  while (node && !node.getAttribute('style')?.includes('display')) {
    node = node.parentElement;
  }
  return node?.getAttribute('style') ?? '';
}

describe('useDependencies 联动取值形态', /** 每种联动声明形态都必须落到可观察的表单项状态。 */ () => {
  it('布尔与函数形态的 if、show、disabled 都生效', /** 布尔值直接写入状态，函数形态取异步结果，两者结果必须一致可观察。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          dependencies: { if: true, triggerFields: ['mode'] },
          fieldName: 'shown',
          label: '布尔显示',
        },
        {
          component: 'VbenInput',
          dependencies: {
            // 函数形态的 show：异步返回 false 时字段保留在 DOM 但被隐藏。
            show: async () => false,
            triggerFields: ['mode'],
          },
          fieldName: 'fnShown',
          label: '函数隐藏',
        },
        {
          component: 'VbenInput',
          dependencies: { show: true, triggerFields: ['mode'] },
          fieldName: 'plainShown',
          label: '布尔显示',
        },
        {
          component: 'VbenInput',
          dependencies: { disabled: true, triggerFields: ['mode'] },
          fieldName: 'plainDisabled',
          label: '布尔禁用',
        },
        {
          component: 'VbenInput',
          dependencies: {
            // 函数形态的 disabled：异步返回 true 时控件被禁用。
            disabled: async () => true,
            triggerFields: ['mode'],
          },
          fieldName: 'fnDisabled',
          label: '函数禁用',
        },
      ],
    });

    expect(wrapper.find('input[name="shown"]').exists()).toBe(true);
    expect(fieldItemStyle(wrapper, 'fnShown')).toContain('display: none');
    expect(fieldItemStyle(wrapper, 'shown')).not.toContain('display: none');
    expect(fieldItemStyle(wrapper, 'plainShown')).not.toContain(
      'display: none',
    );
    expect(
      wrapper.find('input[name="plainDisabled"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.find('input[name="fnDisabled"]').attributes('disabled'),
    ).toBeDefined();
    expect(wrapper.find('input[name="mode"]').attributes('disabled')).toBe(
      undefined,
    );
  });

  it('动态组件参数与动态规则写入表单项', /** componentProps 函数结果必须合并到控件，rules 函数结果必须参与必填判定。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          dependencies: {
            // 异步返回控件参数，渲染后必须出现在真实控件上。
            componentProps: async () => ({ placeholder: '联动占位符' }),
            triggerFields: ['mode'],
          },
          fieldName: 'propsFn',
          label: '动态参数',
        },
        {
          component: 'VbenInput',
          dependencies: {
            // 异步返回 zod 规则：非可选规则会让表单项出现必填标记。
            rules: async () => z.string().min(1, '必填'),
            triggerFields: ['mode'],
          },
          fieldName: 'rulesFn',
          label: '动态规则',
        },
        {
          component: 'VbenInput',
          dependencies: {
            // required 函数返回 true 时同样产生必填标记。
            required: async () => true,
            triggerFields: ['mode'],
          },
          fieldName: 'requiredFn',
          label: '动态必填',
          // 必须同时声明静态规则：只声明 required 会让表单注册应用未定义的 'required' 校验器。
          rules: z.string(),
        },
      ],
    });

    expect(
      wrapper.find('input[name="propsFn"]').attributes('placeholder'),
    ).toBe('联动占位符');
    expect(
      wrapper
        .find('input[name="rulesFn"]')
        .element.closest('.form-is-required'),
    ).not.toBe(null);
    expect(
      wrapper
        .find('input[name="requiredFn"]')
        .element.closest('.form-is-required'),
    ).not.toBe(null);
    // mode 自身没有联动规则，不能被其他字段的必填状态污染。
    expect(
      wrapper.find('input[name="mode"]').element.closest('.form-is-required'),
    ).toBe(null);
  });

  it('trigger 回调收到当前表单值与可用表单上下文', /** trigger 是联动完成后的业务接入点，必须拿到真实值与可继续操作的上下文。 */ async () => {
    const trigger = vi.fn();
    const { formApi, wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          dependencies: {
            trigger,
            triggerFields: ['mode'],
          },
          fieldName: 'triggerFn',
          label: '触发回调',
        },
      ],
    });

    expect(trigger.mock.calls.length).toBeGreaterThan(0);
    const [initialValues, context] = trigger.mock.calls[0] ?? [];
    // 初次联动时表单还没有任何值。
    expect(initialValues).toEqual({});
    // 表单实例含响应式循环结构，只断言可观察的能力，不做对象深度比较。
    expect(typeof context.setFieldValue).toBe('function');

    await formApi.setFieldValue('mode', 'changed');
    await flush(wrapper);

    const [changedValues] = trigger.mock.calls.at(-1) ?? [];
    expect(changedValues).toEqual({ mode: 'changed' });

    // 回调拿到的上下文必须是活着的表单：用它写入的值要能被表单读到。
    await context.setFieldValue('mode', 'from-trigger');
    await flush(wrapper);
    await expect(formApi.getValues()).resolves.toEqual({
      mode: 'from-trigger',
    });
  });

  it('方括号触发字段仍能取到同名字段并驱动联动', /** vee-validate 用 `[字段]` 关闭嵌套路径解析，取到的原始键仍必须驱动本字段联动。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          dependencies: {
            // 方括号写法取 values['mode']，与点号路径在本例中指向同一个字段。
            if: async () => true,
            triggerFields: ['[mode]'],
          },
          fieldName: 'bracket',
          label: '方括号触发',
        },
      ],
    });

    expect(wrapper.find('input[name="bracket"]').exists()).toBe(true);
    expect(fieldItemStyle(wrapper, 'bracket')).not.toContain('display: none');
  });

  it('缺少触发字段时不改变任何联动状态', /** triggerFields 为空时联动整段跳过，字段保持默认可见可用。 */ async () => {
    const { wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          dependencies: {
            // 声明了隐藏与禁用，但没有触发字段：两者都不能生效。
            disabled: true,
            show: false,
            triggerFields: [],
          },
          fieldName: 'shown',
          label: '未声明触发字段',
        },
      ],
    });

    expect(fieldItemStyle(wrapper, 'shown')).not.toContain('display: none');
    expect(wrapper.find('input[name="shown"]').attributes('disabled')).toBe(
      undefined,
    );
  });
  it('组件卸载后联动作用域释放且表单实例不再可用', /** 卸载必须释放联动作用域；已销毁实例的读取要明确失败，不能返回空值。 */ async () => {
    const trigger = vi.fn();
    const { formApi, wrapper } = await mountForm({
      schema: [
        { component: 'VbenInput', fieldName: 'mode', label: '模式' },
        {
          component: 'VbenInput',
          dependencies: { trigger, triggerFields: ['mode'] },
          fieldName: 'triggerFn',
          label: '触发回调',
        },
      ],
    });

    expect(trigger).toHaveBeenCalled();
    wrapper.unmount();

    expect(formApi.isMounted).toBe(false);
    await expect(formApi.getValues()).rejects.toThrow('表单已卸载');
  });
});

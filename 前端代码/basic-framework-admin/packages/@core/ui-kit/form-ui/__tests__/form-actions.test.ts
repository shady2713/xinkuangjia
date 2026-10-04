/**
 * 表单操作区（form-actions）的真实行为回归。
 *
 * 操作区是业务表单提交与重置的唯一按钮入口：点击提交必须先走真实校验、通过后才把
 * 取值交给业务处理器，校验失败或缺少表单 API 时不得回调；点击重置要优先调用业务
 * 重置回调、没有回调时真实还原字段；折叠按钮必须驱动折叠状态并在需要时触发窗口
 * resize。操作区布局类名与按钮顺序同样按属性组合真实生效。
 * 用例挂载真实表单组件（真实校验、真实按钮），只断言可观察的调用与渲染结果。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { useForm } from 'vee-validate';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import FormActions from '../src/components/form-actions.vue';
import { useVbenForm } from '../src/use-form';
import { provideFormProps } from '../src/use-form-context';

/** 业务提交回调签名：接收校验后的表单取值。 */
type SubmitHandler = (values: unknown) => void;

/** 字段结构：一个必填输入项，足以产生校验通过与失败两条链路。 */
const schema = [
  {
    component: 'VbenInput',
    fieldName: 'name',
    label: '名称',
    rules: z.string().min(1, '名称必填'),
  },
];

/**
 * 等待挂载与渲染收敛。
 * @param wrapper 已挂载的组件包装器。
 * @returns 收敛完成后兑现的 Promise。
 */
async function settle(wrapper: VueWrapper) {
  await flushPromises();
  await wrapper.vm.$nextTick();
  await flushPromises();
}

/**
 * 用真实入口创建表单并挂载。
 * @param options 表单属性，与 useVbenForm 的入参一致。
 * @returns 真实表单实例与已挂载的组件包装器。
 */
async function mountForm(options: Record<string, unknown>) {
  const [Form, formApi] = useVbenForm({
    schema,
    ...options,
  } as Parameters<typeof useVbenForm>[0]);
  const wrapper = mount(Form as Component);
  await settle(wrapper);
  return { formApi, wrapper };
}

/**
 * 构造缺少表单 API 的操作区宿主：与真实渲染层一致地提供表单上下文，但不提供 formApi。
 * @param handleSubmit 业务提交回调，用于断言提前返回。
 * @returns 可直接挂载的宿主组件。
 */
function createActionsWithoutFormApi(handleSubmit: SubmitHandler) {
  return defineComponent({
    name: 'FormActionsWithoutApi',
    /**
     * 提供表单上下文并渲染真实操作区组件。
     * @returns 渲染操作区的渲染函数。
     */
    setup() {
      provideFormProps([
        /** 与真实渲染层一致的可变属性对象，但不含 formApi。 */
        { handleSubmit } as never,
        useForm() as never,
      ]);
      return /** 渲染真实操作区组件。 */ () => h(FormActions);
    },
  });
}

/**
 * 按可见文案定位操作区按钮。
 * @param wrapper 已挂载的表单组件包装器。
 * @param text 按钮文案（真实 $t 结果）。
 * @returns 匹配到的按钮包装器。
 * @throws {Error} 未渲染出该文案的按钮时抛出，避免静默跳过断言。
 */
function findButton(wrapper: VueWrapper, text: string) {
  const button = wrapper
    .findAll('button')
    .find(/** 按可见文案筛选按钮。 */ (item) => item.text().includes(text));
  if (!button) {
    throw new Error(`未渲染出文案为 ${text} 的按钮`);
  }
  return button;
}

/**
 * 定位操作区根元素。
 * @param wrapper 已挂载的表单组件包装器。
 * @returns 操作区根元素包装器。
 */
function findActions(wrapper: VueWrapper) {
  return wrapper.get('div.flex.items-center.gap-3');
}

describe('表单操作区', /** 提交与重置按钮是业务表单唯一的人工入口，分支遗漏会直接让表单不可用。 */ () => {
  it('校验通过后点击提交把取值交给业务处理器', /** 不回调或回调空值会让页面收不到用户输入。 */ async () => {
    const handleSubmit = vi.fn();
    const { formApi, wrapper } = await mountForm({ handleSubmit });
    await formApi.setFieldValue('name', '研发部');
    await settle(wrapper);

    await findButton(wrapper, '提交').trigger('click');
    await settle(wrapper);

    expect(handleSubmit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: '研发部' }),
    );
    wrapper.unmount();
  });

  it('校验失败时点击提交不调用业务处理器', /** 未通过校验就回调会让页面拿到非法数据。 */ async () => {
    const handleSubmit = vi.fn();
    const { wrapper } = await mountForm({ handleSubmit });

    await findButton(wrapper, '提交').trigger('click');
    await settle(wrapper);

    expect(handleSubmit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('缺少表单 API 时点击提交不做任何回调', /** 没有表单 API 的调用方必须被提前挡下，而不是先校验再报错。 */ async () => {
    const handleSubmit = vi.fn();
    const wrapper = mount(createActionsWithoutFormApi(handleSubmit));
    await settle(wrapper);

    await findButton(wrapper, '提交').trigger('click');
    await settle(wrapper);

    expect(handleSubmit).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('点击重置优先调用业务重置回调并回传取值', /** 业务重置回调缺失时才会走内部还原，顺序写反会让业务侧清不掉自定义状态。 */ async () => {
    const handleReset = vi.fn();
    const { formApi, wrapper } = await mountForm({ handleReset });
    await formApi.setFieldValue('name', '待重置');
    await settle(wrapper);

    await findButton(wrapper, '重置').trigger('click');
    await settle(wrapper);

    expect(handleReset).toHaveBeenCalledTimes(1);
    expect(handleReset).toHaveBeenCalledWith(
      expect.objectContaining({ name: '待重置' }),
    );
    // 有业务回调时不得同时执行内部还原，取值得以保留给业务处理。
    expect(await formApi.getValues()).toMatchObject({ name: '待重置' });
    wrapper.unmount();
  });

  it('没有业务重置回调时点击重置真实还原字段', /** 不还原会让用户重置后仍看到旧值。 */ async () => {
    const { formApi, wrapper } = await mountForm({});
    // 初始值来自 zod 规则推导，重置必须回到该值而不是清成 undefined。
    const initialValues = await formApi.getValues();
    const initial = initialValues.name;
    await formApi.setFieldValue('name', '待还原');
    await settle(wrapper);

    await findButton(wrapper, '重置').trigger('click');
    await settle(wrapper);

    const resetValues = await formApi.getValues();
    expect(resetValues.name).toBe(initial);
    wrapper.unmount();
  });

  it('操作区类名按紧凑、布局与对齐属性真实组合', /** 类名错位会让搜索表单错行、按钮错位。 */ async () => {
    const compact = await mountForm({
      actionLayout: 'newLine',
      actionPosition: 'center',
      compact: true,
      layout: 'vertical',
    });
    expect(findActions(compact.wrapper).classes()).toEqual(
      expect.arrayContaining([
        'pb-2',
        'self-end',
        'col-span-full',
        'justify-center',
      ]),
    );
    compact.wrapper.unmount();

    const loose = await mountForm({
      actionLayout: 'rowEnd',
      actionPosition: 'left',
      layout: 'inline',
    });
    const looseClasses = findActions(loose.wrapper).classes();
    expect(looseClasses).toEqual(
      expect.arrayContaining(['pb-4', 'self-center', 'col-[-2/-1]']),
    );
    expect(looseClasses).toContain('justify-start');
    expect(looseClasses).not.toContain('w-full');
    loose.wrapper.unmount();

    const right = await mountForm({ actionPosition: 'right' });
    expect(findActions(right.wrapper).classes()).toContain('justify-end');
    right.wrapper.unmount();
  });

  it('操作按钮顺序与显隐按属性真实生效', /** 顺序与显隐写错会让查询表单出现多余按钮或提交按钮位置异常。 */ async () => {
    const reversed = await mountForm({ actionButtonsReverse: true });
    const reversedButtons = reversed.wrapper.findAll('button');
    expect(reversedButtons[0]?.text()).toContain('提交');
    expect(reversedButtons[1]?.text()).toContain('重置');
    reversed.wrapper.unmount();

    const hiddenReset = await mountForm({
      resetButtonOptions: { show: false },
    });
    const hiddenResetButtons = hiddenReset.wrapper.findAll('button');
    expect(hiddenResetButtons).toHaveLength(1);
    expect(hiddenResetButtons[0]?.text()).toContain('提交');
    hiddenReset.wrapper.unmount();

    const customText = await mountForm({
      submitButtonOptions: { content: '保存', show: true },
    });
    expect(findButton(customText.wrapper, '保存').exists()).toBe(true);
    customText.wrapper.unmount();
  });

  it('折叠按钮驱动折叠状态并按需触发窗口 resize', /** 折叠后不触发 resize 会让表格宽度停留在旧尺寸。 */ async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { wrapper } = await mountForm({
      collapseTriggerResize: true,
      showCollapseButton: true,
    });
    expect(wrapper.text()).toContain('收起');
    const before = countResizeEvents(dispatchSpy.mock.calls);

    await wrapper.find('.vben-link').trigger('click');
    await settle(wrapper);

    expect(wrapper.text()).toContain('展开');
    expect(countResizeEvents(dispatchSpy.mock.calls)).toBeGreaterThan(before);
    dispatchSpy.mockRestore();
    wrapper.unmount();
  });

  it('未开启折叠触发 resize 时点击折叠不派发窗口事件', /** 关闭该开关的页面不应被折叠按钮强制重排。 */ async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const { wrapper } = await mountForm({ showCollapseButton: true });
    const before = countResizeEvents(dispatchSpy.mock.calls);

    await wrapper.find('.vben-link').trigger('click');
    await settle(wrapper);

    expect(wrapper.text()).toContain('展开');
    expect(countResizeEvents(dispatchSpy.mock.calls)).toBe(before);
    dispatchSpy.mockRestore();
    wrapper.unmount();
  });
});

/**
 * 统计真实派发到 window 的 resize 事件次数。
 * @param calls dispatchEvent 替身收到的调用参数列表。
 * @returns resize 事件的调用次数。
 */
function countResizeEvents(calls: unknown[][]) {
  return calls.filter(
    /** 只统计 resize 类型的事件。 */ (call) =>
      (call[0] as Event).type === 'resize',
  ).length;
}

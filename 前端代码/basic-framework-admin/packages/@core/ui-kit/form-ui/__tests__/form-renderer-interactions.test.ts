/**
 * 表单渲染层交互（form-ui 的 use-form-renderer.vue）真实行为回归。
 *
 * 该渲染层负责回车提交、字段变更对外抛出与变更后的自动提交：回车判定写错会让
 * textarea 无法换行或表单不提交，变更字段汇总写错会把无关字段报给业务，卸载后
 * 未清理的防抖提交会在组件销毁后仍然发起一次提交。用例通过真实 `useVbenForm`
 * 建立渲染层，驱动真实键盘事件与真实表单值变更，只提供字段插槽占位控件。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVbenForm } from '../src/use-form';
import VbenUseForm from '../src/use-form-renderer.vue';

/** 释放挂起取数的回调；由用例在卸载组件后调用。 */
type ReleasePending = () => void;

/** 自动提交防抖窗口（毫秒）；与实现约定的 300ms 对齐，用于区分是否安排了提交。 */
const SUBMIT_DEBOUNCE_MS = 300;

/** 两条字段声明，用于核对按字段汇总变更与跳过未变化字段。 */
const twoFields = [
  { component: 'VbenInput', fieldName: 'name', label: '名称' },
  { component: 'VbenInput', fieldName: 'detail', label: '备注' },
];

/** 字段插槽占位控件：用普通输入元素替代真实控件，聚焦渲染层自身的交互逻辑。 */
const fieldSlots = {
  /** 备注字段的占位控件。 */
  detail: () => h('input', { 'data-test': 'field-detail' }),
  /** 名称字段的占位控件。 */
  name: () => h('input', { 'data-test': 'field-name' }),
};

/**
 * 挂载真实表单渲染层并返回操作实例。
 * @param options 表单属性，透传给真实 `useVbenForm`。
 * @returns 已挂载的组件包装器与表单操作实例。
 */
function mountForm(options: Record<string, unknown>) {
  const [Form, formApi] = useVbenForm(options);
  const wrapper = mount(Form as Component, { slots: fieldSlots });
  return { formApi, wrapper };
}

/**
 * 等待渲染层的挂载副作用建立完成：值变化监听在 onMounted 的下一个 tick 才创建。
 * @returns 收敛后的 Promise。
 */
async function settleRenderer() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

/**
 * 在表单内建立真实 textarea 并从其上派发回车事件。
 * @param wrapper 已挂载的表单组件。
 * @returns 派发出去的回车事件，用于核对默认行为是否被阻止。
 * @throws 表单根元素不存在时报告渲染回归。
 */
function dispatchEnterFromTextarea(wrapper: ReturnType<typeof mount>) {
  const form = wrapper.get('form').element;
  const textarea = document.createElement('textarea');
  form.append(textarea);
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
  });
  textarea.dispatchEvent(event);
  return event;
}

afterEach(
  /** 恢复被替换的全局计时器与原型方法，避免影响其它用例。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('渲染层回车提交', /** 回车提交是表单的主要快捷入口，判定与阻止默认行为都不能出错。 */ () => {
  it('未开启回车提交时不触发提交', /** 缺省配置下回车只应留给控件自身，不能偷偷提交表单。 */ async () => {
    const handleSubmit = vi.fn();
    const { formApi, wrapper } = mountForm({
      handleSubmit,
      schema: twoFields,
      submitOnEnter: false,
    });
    await settleRenderer();
    const submit = vi.spyOn(formApi, 'validateAndSubmitForm');

    await wrapper.get('form').trigger('keydown.enter');
    await flushPromises();

    expect(formApi.isMounted).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('textarea 内回车保留换行且不阻止默认行为', /** 备注一类多行输入必须能换行，拦截回车会让用户无法输入第二行。 */ async () => {
    const handleSubmit = vi.fn();
    const { formApi, wrapper } = mountForm({
      handleSubmit,
      schema: twoFields,
      submitOnEnter: true,
    });
    await settleRenderer();
    const submit = vi.spyOn(formApi, 'validateAndSubmitForm');

    const event = dispatchEnterFromTextarea(wrapper);
    await flushPromises();

    expect(event.defaultPrevented).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('开启回车提交时阻止默认行为并提交表单', /** 普通输入框回车必须提交，否则用户只能依赖鼠标点击按钮。 */ async () => {
    const handleSubmit = vi.fn();
    const { formApi, wrapper } = mountForm({
      handleSubmit,
      schema: twoFields,
      submitOnEnter: true,
    });
    await settleRenderer();
    const submit = vi.spyOn(formApi, 'validateAndSubmitForm');

    const form = wrapper.get('form');
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
    });
    form.element.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('渲染层字段变更通知', /** 变更字段汇总决定业务拿到哪些字段，多报或少报都会造成错误联动。 */ () => {
  it('只把真正变化的字段通知给业务', /** 一次只改一个字段时不能把整张表的字段都报成变更。 */ async () => {
    const handleValuesChange = vi.fn();
    const { formApi } = mountForm({
      handleValuesChange,
      schema: twoFields,
      submitOnChange: false,
    });
    await settleRenderer();

    await formApi.setFieldValue('name', '新名称');
    await flushPromises();

    expect(handleValuesChange).toHaveBeenCalledTimes(1);
    const [values, changedFields] = handleValuesChange.mock.calls[0] as [
      Record<string, unknown>,
      string[],
    ];
    expect(changedFields).toEqual(['name']);
    expect(values).toMatchObject({ name: '新名称' });
  });

  it('第二次变更只通知本次变化的字段', /** 缺少上次快照会让同一字段被反复上报，或漏报新变化的字段。 */ async () => {
    const handleValuesChange = vi.fn();
    const { formApi } = mountForm({
      handleValuesChange,
      schema: twoFields,
      submitOnChange: false,
    });
    await settleRenderer();

    await formApi.setFieldValue('name', '新名称');
    await flushPromises();
    await formApi.setFieldValue('detail', '补充说明');
    await flushPromises();

    expect(handleValuesChange).toHaveBeenCalledTimes(2);
    expect(handleValuesChange.mock.calls[1]?.[1]).toEqual(['detail']);
    expect(handleValuesChange.mock.calls[1]?.[0]).toMatchObject({
      detail: '补充说明',
      name: '新名称',
    });
  });

  it('未配置变更回调时仍按开启状态安排自动提交', /** 未配置回调不能连带关闭变更提交能力。 */ async () => {
    const handleSubmit = vi.fn();
    const { formApi } = mountForm({
      handleSubmit,
      schema: twoFields,
      submitOnChange: true,
    });
    await settleRenderer();

    await formApi.setFieldValue('name', '新名称');
    await vi.waitFor(
      /** 等待防抖窗口结束后的自动提交真正执行。 */ () => {
        expect(handleSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
  });
});

describe('渲染层折叠状态', /** 折叠状态由表单实例持有，状态与回调必须同步更新。 */ () => {
  it('点击折叠按钮写入实例状态并通知业务', /** 只改本地状态会让其它读取表单实例的组件仍按展开态渲染。 */ async () => {
    const handleCollapsedChange = vi.fn();
    const { formApi, wrapper } = mountForm({
      handleCollapsedChange,
      schema: twoFields,
      showCollapseButton: true,
    });
    await settleRenderer();
    expect(formApi.state?.collapsed).toBe(false);

    await wrapper.get('.vben-link').trigger('click');
    await flushPromises();

    expect(formApi.state?.collapsed).toBe(true);
    expect(handleCollapsedChange).toHaveBeenCalledWith(true);
  });

  it('再次点击恢复展开状态', /** 折叠开关必须可逆，否则表单展开后无法收起。 */ async () => {
    const handleCollapsedChange = vi.fn();
    const { formApi, wrapper } = mountForm({
      handleCollapsedChange,
      schema: twoFields,
      showCollapseButton: true,
    });
    await settleRenderer();

    await wrapper.get('.vben-link').trigger('click');
    await flushPromises();
    await wrapper.get('.vben-link').trigger('click');
    await flushPromises();

    expect(formApi.state?.collapsed).toBe(false);
    expect(handleCollapsedChange).toHaveBeenLastCalledWith(false);
  });
});

describe('渲染层卸载清理', /** 卸载后残留的监听与防抖提交会操作已销毁的页面状态。 */ () => {
  it('卸载时取消尚未触发的防抖提交', /** 未取消的计时器会在组件销毁后仍然发起一次提交。 */ async () => {
    const handleSubmit = vi.fn();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { formApi, wrapper } = mountForm({
      handleSubmit,
      schema: twoFields,
      submitOnChange: true,
    });
    await settleRenderer();

    await formApi.setFieldValue('name', '新名称');
    await flushPromises();
    expect(clearSpy).not.toHaveBeenCalled();

    wrapper.unmount();
    await flushPromises();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('变更回调中卸载表单后不再安排自动提交', /** 业务回调里关闭抽屉是常见操作，此后不能再发起提交。 */ async () => {
    const handleSubmit = vi.fn();
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    /** 已挂载的表单包装器；挂载完成后赋值，供变更回调卸载组件。 */
    let mountedWrapper: undefined | VueWrapper;
    const handleValuesChange = vi.fn(
      /** 模拟业务在变更回调中关闭承载表单的容器。 */ () => {
        mountedWrapper?.unmount();
      },
    );
    const { formApi, wrapper } = mountForm({
      handleSubmit,
      handleValuesChange,
      schema: twoFields,
      submitOnChange: true,
    });
    mountedWrapper = wrapper;
    await settleRenderer();

    await formApi.setFieldValue('name', '新名称');
    await flushPromises();

    expect(handleValuesChange).toHaveBeenCalledTimes(1);
    expect(
      timerSpy.mock.calls.filter(
        /** 只统计自动提交防抖窗口的计时器。 */ (call) =>
          call[1] === SUBMIT_DEBOUNCE_MS,
      ),
    ).toHaveLength(0);
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  it('未卸载时会安排一次防抖自动提交', /** 负对照：证明上一条断言来自卸载清理而不是自动提交从未生效。 */ async () => {
    const handleSubmit = vi.fn();
    const timerSpy = vi.spyOn(globalThis, 'setTimeout');
    const { formApi } = mountForm({
      handleSubmit,
      schema: twoFields,
      submitOnChange: true,
    });
    await settleRenderer();

    await formApi.setFieldValue('name', '新名称');
    await flushPromises();

    expect(
      timerSpy.mock.calls.filter(
        /** 只统计自动提交防抖窗口的计时器。 */ (call) =>
          call[1] === SUBMIT_DEBOUNCE_MS,
      ),
    ).toHaveLength(1);
  });
});

describe('渲染层缺少表单实例时的变更回退', /** 表单实例属性在挂载后被移除时，变更通知仍必须可用且字段不丢失。 */ () => {
  it('表单实例缺失时以空值对象通知变更字段', /** 读取实例值失败会让变更通知整体中断，业务收不到字段联动。 */ async () => {
    const handleValuesChange = vi.fn();
    const [, formApi] = useVbenForm({
      handleValuesChange,
      schema: twoFields,
      submitOnChange: false,
    });
    // 直接挂载渲染层，才能在挂载完成后移除表单实例属性。
    const wrapper = mount(VbenUseForm as Component, {
      props: {
        formApi,
        handleValuesChange,
        schema: twoFields,
        submitOnChange: false,
      },
    });
    await settleRenderer();
    await formApi.setFieldValue('name', '初始值');
    await flushPromises();
    expect(handleValuesChange).toHaveBeenCalledTimes(1);
    handleValuesChange.mockClear();

    await wrapper.setProps({ formApi: undefined });
    await nextTick();
    // 底层表单仍由原实例持有，此处模拟实例属性被移除后表单值继续变化。
    await formApi.setFieldValue('name', '变更后的名称');
    await flushPromises();

    expect(handleValuesChange).toHaveBeenCalledTimes(1);
    const [values, changedFields] = handleValuesChange.mock.calls[0] as [
      Record<string, unknown>,
      string[],
    ];
    expect(values).toEqual({});
    expect(changedFields).toEqual(['name']);
  });
});

describe('渲染层取数期间卸载', /** 取数未完成时组件已销毁，此时不得再通知业务，避免操作已销毁的页面状态。 */ () => {
  it('取数期间卸载后不再通知变更字段', /** 卸载后继续通知会让业务写入已销毁组件的状态并触发报错。 */ async () => {
    const handleValuesChange = vi.fn();
    const { formApi, wrapper } = mountForm({
      handleValuesChange,
      schema: twoFields,
      submitOnChange: false,
    });
    await settleRenderer();
    await formApi.setFieldValue('name', '初始值');
    await flushPromises();
    expect(handleValuesChange).toHaveBeenCalledTimes(1);
    handleValuesChange.mockClear();

    // 取数在卸载前先拿到真实快照，随后挂起，模拟慢请求跨越组件销毁时刻。
    const snapshot = await formApi.getValues();
    let releaseValues: ReleasePending | undefined;
    const pendingValues = new Promise<void>(
      /** 记录释放函数，由用例在卸载后调用。 */ (resolve) => {
        releaseValues = resolve;
      },
    );
    vi.spyOn(formApi, 'getValues').mockImplementation(
      /** 返回卸载前捕获的真实表单值。 */ async () => {
        await pendingValues;
        return snapshot;
      },
    );

    await formApi.setFieldValue('name', '卸载前的变更');
    await flushPromises();
    wrapper.unmount();
    releaseValues?.();
    await flushPromises();

    expect(handleValuesChange).not.toHaveBeenCalled();
  });
});

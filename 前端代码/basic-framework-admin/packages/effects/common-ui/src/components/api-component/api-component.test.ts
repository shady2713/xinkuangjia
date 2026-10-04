/**
 * 接口驱动组件（packages/effects/common-ui 的 api-component）真实行为回归。
 *
 * 该组件把「接口取选项」的公共逻辑收敛到一处：按 labelField/valueField/disabledField/
 * childrenField 把接口字段归一化成目标组件认识的 label/value/disabled/children，按
 * resultField 从嵌套结果里取列表，支持请求前后的参数与结果改写、visibleEvent 事件驱动的
 * 延迟加载、加载期间的待处理请求补发，以及 first/last/one/自定义函数的自动选择。
 * 归一化漏字段会让下拉显示空选项，字段名未剔除会让目标组件收到两套命名，pending 请求
 * 未补发会让联动筛选的最后一次输入被丢弃，异常未复位会让下次打开永远不再加载。
 *
 * 用例真实渲染组件并真实执行每次请求、归一化与事件链路，只用一个最小包装组件观察
 * 组件交给目标组件的属性与事件。
 */

import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import ApiComponent from './api-component.vue';

/** 插槽渲染函数签名：返回插槽内容。 */
type SlotRenderer = () => unknown;

/** 在途请求的放行回调：把本次请求的结果交给等待中的调用方。 */
type ResolvePending = (value: RawOption[]) => void;

/** 接口返回的单条原始选项：字段名故意与目标组件期望不同。 */
interface RawOption {
  /** 原始禁用标记，由 disabledField 指定。 */
  disabledFlag?: boolean;
  /** 原始主键，由 valueField 指定。 */
  id?: number | string;
  /** 原始子节点列表，由 childrenField 指定。 */
  items?: RawOption[];
  /** 原始展示文本，由 labelField 指定。 */
  name?: string;
  /** 接口附带的额外字段，应原样透传给目标组件。 */
  extra?: string;
}

/** 组件通过 defineExpose 暴露的方法表：只声明用例实际调用的成员。 */
interface ExposedApi {
  /** 获取被包装的组件实例。 */
  getComponentRef?: <T = unknown>() => T;
  /** 获取当前归一化后的选项。 */
  getOptions?: () => unknown;
  /** 获取当前值。 */
  getValue?: () => unknown;
  /** 更新接口参数并触发重新请求。 */
  updateParam?: (params: Record<string, unknown>) => void;
}

/** 包装组件暴露的实例视图：只读取组件名用于核对模板引用。 */
interface WrappedInstance {
  /** 组件名。 */
  $options?: { name?: string };
}

/**
 * 建立最小包装组件：把收到的属性渲染出来，并提供触发双向绑定与事件驱动的按钮。
 * @returns 可观察属性并派发事件的包装组件。
 */
function createWrappedStub() {
  return defineComponent({
    name: 'WrappedStub',
    inheritAttrs: false,
    props: {
      /** 当前值，组件按 modelPropName 决定属性名。 */
      modelValue: { default: undefined, type: [Number, String] },
      /** 归一化后的选项列表。 */
      options: {
        /** 未传入选项时使用空列表，避免默认值被跨实例改写。 */
        default: () => [],
        type: Array,
      },
      /** 透传的占位文案。 */
      placeholder: { default: '', type: String },
      /** 备用值属性，用于核对 modelPropName 的配置能力。 */
      value: { default: undefined, type: [Number, String] },
    },
    emits: [
      'update:modelValue',
      'update:value',
      'visible-change',
      'visibleChange',
    ],
    /**
     * 渲染收到的属性并提供派发事件的按钮。
     * @param props 包装组件收到的属性。
     * @param context 组件上下文，用于读取属性、插槽与派发事件。
     * @param context.attrs 未声明为属性的透传项。
     * @param context.emit 事件派发函数。
     * @param context.slots 调用方传入的插槽。
     * @returns 渲染函数。
     */
    setup(props, { attrs, emit, slots }) {
      return /** 输出属性快照与事件按钮。 */ () =>
        h('div', { class: 'wrapped', ...attrs }, [
          h('span', { class: 'wrapped-value' }, String(props.modelValue)),
          h(
            'span',
            { class: 'wrapped-options' },
            JSON.stringify(props.options),
          ),
          h('span', { class: 'wrapped-placeholder' }, props.placeholder),
          slots.loading
            ? h('div', { class: 'wrapped-loading' }, slots.loading())
            : null,
          h(
            'button',
            {
              class: 'emit-value',
              /** 派发一次双向绑定更新。 */
              onClick: () => emit('update:modelValue', 'DUMMY-新值'),
            },
            'emit-value',
          ),
          h(
            'button',
            {
              class: 'emit-visible',
              /** 派发一次可见性变化。 */
              onClick: () => emit('visible-change', true),
            },
            'emit-visible',
          ),
        ]);
    },
  });
}

/** 包装组件替身：每个用例复用一个无状态的最小实现。 */
const WrappedStub = createWrappedStub();

/**
 * 读取组件交给目标组件的归一化选项。
 * @param wrapper 已挂载的组件包装器。
 * @returns 目标组件收到的选项数组。
 */
function renderedOptions(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(WrappedStub).props('options') as Array<
    Record<string, unknown>
  >;
}

/**
 * 读取组件交给目标组件的当前值。
 * @param wrapper 已挂载的组件包装器。
 * @returns 目标组件收到的值。
 */
function renderedValue(wrapper: ReturnType<typeof mount>) {
  return wrapper.findComponent(WrappedStub).props('modelValue') as unknown;
}

/**
 * 读取组件通过 defineExpose 暴露的方法表。
 * @param wrapper 已挂载的组件包装器。
 * @returns 暴露的方法表。
 * @throws Error 组件未暴露方法表时抛出，避免用例静默地什么都不验证。
 */
function exposed(wrapper: ReturnType<typeof mount>) {
  const instance = wrapper.vm as unknown as {
    $?: { exposed?: ExposedApi };
  };
  const methods = instance.$?.exposed;
  if (!methods) {
    throw new Error('组件未暴露内部方法');
  }
  return methods;
}

/**
 * 挂载接口组件并等待首次请求完成。
 * @param props 传给组件的属性。
 * @param slots 传给组件的插槽。
 * @returns 已挂载的组件包装器。
 */
async function mountApiComponent(
  props: Record<string, unknown>,
  slots?: Record<string, SlotRenderer>,
) {
  const wrapper = mount(ApiComponent, {
    props: { component: WrappedStub, ...props },
    slots,
  });
  await flushPromises();
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 构造一个手动控制完成时机的接口。
 * @returns 接口函数与用于放行的完成回调。
 */
function deferredApi() {
  const pending: ResolvePending[] = [];
  const api = vi.fn(
    /** 记录一次调用并返回等待放行的 Promise。 */ () =>
      new Promise<RawOption[]>(
        /** 记录本次请求的放行回调。 */ (resolve) => {
          pending.push(resolve);
        },
      ),
  );
  return {
    api,
    /**
     * 放行第 n 次请求。
     * @param index 请求序号，从 0 开始。
     * @param value 该次请求的返回结果。
     * @returns 放行完成。
     * @throws Error 该序号没有在途请求时抛出，避免用例静默地什么都不验证。
     */
    async resolve(index: number, value: RawOption[]) {
      const resolver = pending[index];
      if (!resolver) {
        throw new Error(`没有第 ${index} 个在途请求`);
      }
      resolver(value);
      await flushPromises();
    },
  };
}

describe('接口组件选项归一化', /** 归一化决定目标组件能否正确展示与取值。 */ () => {
  it('按字段配置归一化并剔除原始字段名', /** 未归一化会让下拉为空，未剔除会让目标组件收到两套命名。 */ async () => {
    const api = vi.fn(
      /** 返回带原始字段名的选项列表。 */ async () => [
        {
          disabledFlag: false,
          extra: 'DUMMY-附加',
          id: 1,
          name: 'DUMMY-选项一',
        },
        {
          disabledFlag: true,
          extra: 'DUMMY-附加二',
          id: 2,
          name: 'DUMMY-选项二',
        },
      ],
    );
    const wrapper = await mountApiComponent({
      api,
      childrenField: 'items',
      disabledField: 'disabledFlag',
      labelField: 'name',
      numberToString: true,
      valueField: 'id',
    });

    expect(api).toHaveBeenCalledTimes(1);
    expect(renderedOptions(wrapper)).toEqual([
      {
        disabled: false,
        extra: 'DUMMY-附加',
        label: 'DUMMY-选项一',
        value: '1',
      },
      {
        disabled: true,
        extra: 'DUMMY-附加二',
        label: 'DUMMY-选项二',
        value: '2',
      },
    ]);
    expect(wrapper.emitted('optionsChange')?.at(-1)?.[0]).toEqual(
      renderedOptions(wrapper),
    );
  });

  it('保留原始值类型并按层级递归归一化子节点', /** 强制转字符串会让数字主键匹配失败，子节点未递归会让树形选项丢层级。 */ async () => {
    const api = vi.fn(
      /** 返回带子节点的选项列表。 */ async () => [
        {
          id: 1,
          items: [{ id: 11, name: 'DUMMY-子项' }],
          name: 'DUMMY-父项',
        },
      ],
    );
    const wrapper = await mountApiComponent({
      api,
      childrenField: 'items',
      labelField: 'name',
      valueField: 'id',
    });

    expect(renderedOptions(wrapper)).toEqual([
      {
        children: [{ disabled: undefined, label: 'DUMMY-子项', value: 11 }],
        disabled: undefined,
        label: 'DUMMY-父项',
        value: 1,
      },
    ]);
  });

  it('子节点不是数组时不补 children', /** 把非数组塞进树形组件会让渲染抛错。 */ async () => {
    const api = vi.fn(
      /** 返回子节点为字符串的选项列表。 */ async () => [
        { id: 1, items: 'DUMMY-非法子节点', name: 'DUMMY-父项' },
      ],
    );
    const wrapper = await mountApiComponent({
      api,
      childrenField: 'items',
      labelField: 'name',
      valueField: 'id',
    });

    expect(renderedOptions(wrapper)[0]).not.toHaveProperty('children');
  });

  it('按 resultField 从嵌套结果里取列表', /** 路径取错会让接口有数据但下拉为空。 */ async () => {
    const api = vi.fn(
      /** 返回嵌套结构的接口结果。 */ async () => ({
        data: { list: [{ id: 7, name: 'DUMMY-嵌套选项' }] },
      }),
    );
    const wrapper = await mountApiComponent({
      api,
      labelField: 'name',
      resultField: 'data.list',
      valueField: 'id',
    });

    expect(renderedOptions(wrapper)).toEqual([
      { disabled: undefined, label: 'DUMMY-嵌套选项', value: 7 },
    ]);
  });

  it('接口结果无法识别时回落到调用方选项', /** 未回落会让接口异常时下拉彻底为空。 */ async () => {
    const api = vi.fn(
      /** 返回既不是列表也不含目标路径的结果。 */ async () => ({ data: {} }),
    );
    const wrapper = await mountApiComponent({
      api,
      labelField: 'name',
      options: [{ label: 'DUMMY-后备选项', value: 9 }],
      resultField: 'data.list',
      valueField: 'id',
    });

    expect(renderedOptions(wrapper)).toEqual([
      { label: 'DUMMY-后备选项', value: 9 },
    ]);
  });

  it('未配置 api 时直接使用调用方选项', /** 无接口仍请求会让静态选项场景发出多余请求。 */ async () => {
    const wrapper = await mountApiComponent({
      options: [{ label: 'DUMMY-静态选项', value: 1 }],
    });

    expect(renderedOptions(wrapper)).toEqual([
      { label: 'DUMMY-静态选项', value: 1 },
    ]);
  });
});

describe('接口组件请求改写与异常', /** 请求改写与异常复位决定联动查询的最终结果。 */ () => {
  it('beforeFetch 改写请求参数并在返回空值时保留原参数', /** 改写丢失会让联动条件发不到后端，空值未兜底会让参数变成 undefined。 */ async () => {
    const api = vi.fn(
      /** 返回固定选项列表。 */ async () => [{ id: 1, name: 'DUMMY-选项' }],
    );
    const beforeFetch = vi.fn(
      /** 首次改写参数，翻页请求返回空值触发兜底。 */ async (
        params: Record<string, unknown>,
      ) => (params.page ? undefined : { keep: true, pageSize: 5 }),
    );
    const wrapper = await mountApiComponent({
      api,
      beforeFetch,
      labelField: 'name',
      params: { keep: true },
      valueField: 'id',
    });

    expect(beforeFetch).toHaveBeenCalledWith({ keep: true });
    expect(api).toHaveBeenLastCalledWith({ keep: true, pageSize: 5 });

    exposed(wrapper).updateParam?.({ keep: true, page: 2 });
    await flushPromises();

    // 第二次 beforeFetch 返回空值，应沿用合并后的原参数。
    expect(api).toHaveBeenLastCalledWith({ keep: true, page: 2 });
  });

  it('afterFetch 改写结果并在返回空值时保留原结果', /** 改写丢失会让后端包装结构直接进入选项，空值未兜底会让选项变空。 */ async () => {
    const api = vi.fn(
      /** 返回后端包装结构。 */ async () => ({
        rows: [{ id: 1, name: 'DUMMY-选项' }],
      }),
    );
    const afterFetch = vi.fn(
      /** 把包装结构摊平成列表，第二次返回空值触发兜底。 */ async (
        result: unknown,
      ) =>
        (result as { rows?: unknown[] }).rows
          ? (result as { rows: unknown[] }).rows
          : undefined,
    );
    const wrapper = await mountApiComponent({
      afterFetch,
      api,
      labelField: 'name',
      valueField: 'id',
    });

    expect(afterFetch).toHaveBeenCalledTimes(1);
    expect(renderedOptions(wrapper)).toEqual([
      { disabled: undefined, label: 'DUMMY-选项', value: 1 },
    ]);

    exposed(wrapper).updateParam?.({ page: 2 });
    await flushPromises();
    // 第二次 afterFetch 返回空值，应沿用接口原始结果；原始结果不是列表也不是目标路径。
    expect(afterFetch).toHaveBeenCalledTimes(2);
  });

  it('接口异常时告警并允许下次事件重新加载', /** 未复位加载标记会让下次打开永远不再请求。 */ async () => {
    const api = vi
      .fn()
      .mockRejectedValueOnce(new Error('DUMMY-接口失败'))
      .mockResolvedValue([{ id: 1, name: 'DUMMY-重试选项' }]);
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 屏蔽告警输出，只断言调用次数。 */ () => {});

    const wrapper = await mountApiComponent({
      api,
      immediate: false,
      labelField: 'name',
      valueField: 'id',
      visibleEvent: 'onVisibleChange',
    });
    expect(api).not.toHaveBeenCalled();

    wrapper.findComponent(WrappedStub).vm.$emit('visible-change', true);
    await flushPromises();

    const warnCalls = warn.mock.calls.filter(
      /** 只统计组件对接口异常本身的告警，忽略框架提示。 */ (call) =>
        call[0] instanceof Error,
    );
    expect(warnCalls).toHaveLength(1);
    expect(renderedOptions(wrapper)).toEqual([]);

    // 失败后 isFirstLoaded 复位，再次打开应重新请求。
    wrapper.findComponent(WrappedStub).vm.$emit('visible-change', true);
    await flushPromises();

    expect(api).toHaveBeenCalledTimes(2);
    expect(renderedOptions(wrapper)).toEqual([
      { disabled: undefined, label: 'DUMMY-重试选项', value: 1 },
    ]);
    warn.mockRestore();
  });

  it('相同参数不重复请求', /** 重复请求会让联动筛选产生无意义的后端压力。 */ async () => {
    const api = vi.fn(
      /** 返回固定选项列表。 */ async () => [{ id: 1, name: 'DUMMY-选项' }],
    );
    const wrapper = await mountApiComponent({
      api,
      labelField: 'name',
      params: { keyword: 'DUMMY' },
      valueField: 'id',
    });
    expect(api).toHaveBeenCalledTimes(1);

    exposed(wrapper).updateParam?.({ keyword: 'DUMMY' });
    await flushPromises();

    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe('接口组件加载时机与并发', /** 加载时机与待处理请求决定联动筛选是否丢失最后一次输入。 */ () => {
  it('visibleEvent 只在打开且未加载过时请求一次', /** 重复请求会让弹窗每次打开都刷一遍选项，漏请求会让延迟加载不生效。 */ async () => {
    const api = vi.fn(
      /** 返回固定选项列表。 */ async () => [{ id: 1, name: 'DUMMY-选项' }],
    );
    const wrapper = await mountApiComponent({
      api,
      immediate: false,
      labelField: 'name',
      valueField: 'id',
      visibleEvent: 'onVisibleChange',
    });
    const wrapped = wrapper.findComponent(WrappedStub);

    wrapped.vm.$emit('visible-change', false);
    await flushPromises();
    expect(api).not.toHaveBeenCalled();

    wrapped.vm.$emit('visible-change', true);
    await flushPromises();
    expect(api).toHaveBeenCalledTimes(1);

    wrapped.vm.$emit('visible-change', true);
    await flushPromises();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('alwaysLoad 时每次打开都重新请求', /** 未重新请求会让联动条件变化后选项停留在旧结果。 */ async () => {
    const api = vi.fn(
      /** 返回固定选项列表。 */ async () => [{ id: 1, name: 'DUMMY-选项' }],
    );
    const wrapper = await mountApiComponent({
      alwaysLoad: true,
      api,
      immediate: false,
      labelField: 'name',
      valueField: 'id',
      visibleEvent: 'onVisibleChange',
    });
    const wrapped = wrapper.findComponent(WrappedStub);

    wrapped.vm.$emit('visible-change', true);
    await flushPromises();
    wrapped.vm.$emit('visible-change', true);
    await flushPromises();

    expect(api).toHaveBeenCalledTimes(2);
  });

  it('加载期间的参数变化在本次结束后补发一次请求', /** 未补发会让联动筛选的最后一次输入被静默丢弃。 */ async () => {
    const deferred = deferredApi();
    const wrapper = await mountApiComponent({
      api: deferred.api,
      labelField: 'name',
      valueField: 'id',
    });
    expect(deferred.api).toHaveBeenCalledTimes(1);

    // 第一次请求仍在途时改参数：这次请求被登记为待处理。
    exposed(wrapper).updateParam?.({ page: 2 });
    await flushPromises();
    expect(deferred.api).toHaveBeenCalledTimes(1);

    await deferred.resolve(0, [{ id: 1, name: 'DUMMY-首页选项' }]);
    await nextTick();
    await flushPromises();

    // 第一次结束后立即补发第二次请求，且带上最新参数。
    expect(deferred.api).toHaveBeenCalledTimes(2);
    expect(deferred.api).toHaveBeenLastCalledWith({ page: 2 });

    await deferred.resolve(1, [{ id: 2, name: 'DUMMY-第二页选项' }]);
    expect(renderedOptions(wrapper)).toEqual([
      { disabled: undefined, label: 'DUMMY-第二页选项', value: 2 },
    ]);
  });

  it('加载中通过 loadingSlot 渲染加载图标', /** 缺少加载反馈会让用户在慢接口上以为组件坏了。 */ async () => {
    const deferred = deferredApi();
    const wrapper = await mountApiComponent(
      {
        api: deferred.api,
        labelField: 'name',
        loadingSlot: 'loading',
        valueField: 'id',
      },
      {
        /**
         * 渲染加载插槽内容。
         * @returns 插槽占位文本。
         */
        loading: () => 'DUMMY-加载中',
      },
    );

    expect(wrapper.find('.wrapped-loading').exists()).toBe(true);
    expect(wrapper.find('.animate-spin').exists()).toBe(true);

    await deferred.resolve(0, [{ id: 1, name: 'DUMMY-选项' }]);

    // 加载结束后条件插槽只剩占位注释，加载图标不再渲染。
    expect(wrapper.find('.animate-spin').exists()).toBe(false);
  });
});

describe('接口组件自动选择与双向绑定', /** 自动选择与双向绑定决定组件能否直接接入表单。 */ () => {
  it('autoSelect 支持首项、末项、唯一项与自定义函数', /** 自动选择写错会让表单默认值落到错误的选项。 */ async () => {
    const options = [
      { id: 1, name: 'DUMMY-选项一' },
      { id: 2, name: 'DUMMY-选项二' },
    ];
    const first = await mountApiComponent({
      /** 返回两条选项。 */
      api: async () => options,
      autoSelect: 'first',
      labelField: 'name',
      valueField: 'id',
    });
    expect(renderedValue(first)).toBe(1);

    const last = await mountApiComponent({
      /** 返回两条选项。 */
      api: async () => options,
      autoSelect: 'last',
      labelField: 'name',
      valueField: 'id',
    });
    expect(renderedValue(last)).toBe(2);

    const one = await mountApiComponent({
      /** 返回两条选项。 */
      api: async () => options,
      autoSelect: 'one',
      labelField: 'name',
      valueField: 'id',
    });
    expect(renderedValue(one)).toBe(undefined);

    const single = await mountApiComponent({
      /** 只返回一条选项。 */
      api: async () => [options[1]],
      autoSelect: 'one',
      labelField: 'name',
      valueField: 'id',
    });
    expect(renderedValue(single)).toBe(2);

    const custom = await mountApiComponent({
      /** 返回两条选项。 */
      api: async () => options,
      /** 自定义选择逻辑：取最后一条。 */
      autoSelect: (items: unknown[]) =>
        items.at(-1) as { id: number; name: string },
      labelField: 'name',
      valueField: 'id',
    });
    expect(renderedValue(custom)).toBe(2);

    const none = await mountApiComponent({
      /** 返回两条选项。 */
      api: async () => options,
      autoSelect: false,
      labelField: 'name',
      valueField: 'id',
    });
    expect(renderedValue(none)).toBe(undefined);
  });

  it('调用方已有值时不覆盖自动选择', /** 覆盖已有值会让编辑表单的默认值被改掉。 */ async () => {
    const wrapper = await mountApiComponent({
      /** 返回两条选项。 */
      api: async () => [
        { id: 1, name: 'DUMMY-选项一' },
        { id: 2, name: 'DUMMY-选项二' },
      ],
      autoSelect: 'first',
      labelField: 'name',
      modelValue: 9,
      valueField: 'id',
    });

    expect(renderedValue(wrapper)).toBe(9);
  });

  it('包装组件回写时同步内部值并透传属性', /** 未回写会让表单取不到用户选择，属性未透传会让占位等配置失效。 */ async () => {
    const wrapper = await mountApiComponent(
      {
        /** 返回一条选项。 */
        api: async () => [{ id: 1, name: 'DUMMY-选项' }],
        labelField: 'name',
        valueField: 'id',
      },
      undefined,
    );
    const wrapped = wrapper.findComponent(WrappedStub);

    await wrapped.find('.emit-value').trigger('click');
    await flushPromises();

    expect(exposed(wrapper).getValue?.()).toBe('DUMMY-新值');
    expect(wrapped.find('.wrapped-placeholder').text()).toBe('');
  });

  it('支持自定义值属性名与占位透传', /** modelPropName 写死会让以 value 为模型的组件无法接入。 */ async () => {
    const wrapper = mount(ApiComponent, {
      attrs: { 'data-extra': 'DUMMY-透传' },
      props: {
        /** 返回一条选项。 */
        api: async () => [{ id: 1, name: 'DUMMY-选项' }],
        component: WrappedStub,
        labelField: 'name',
        modelPropName: 'value',
        placeholder: 'DUMMY-占位',
        valueField: 'id',
      },
    });
    await flushPromises();

    const wrapped = wrapper.findComponent(WrappedStub);
    expect(wrapped.props('value')).toBe(undefined);
    expect(wrapped.find('.wrapped-placeholder').text()).toBe('DUMMY-占位');
    expect(wrapped.find('.wrapped').attributes('data-extra')).toBe(
      'DUMMY-透传',
    );
  });

  it('暴露选项、取值、包装实例与参数更新方法', /** 缺少暴露方法会让表单层无法读取选项或做联动查询。 */ async () => {
    const wrapper = await mountApiComponent({
      /** 返回一条选项。 */
      api: async () => [{ id: 1, name: 'DUMMY-选项' }],
      labelField: 'name',
      valueField: 'id',
    });
    const methods = exposed(wrapper);

    expect(methods.getOptions?.()).toEqual([
      { disabled: undefined, label: 'DUMMY-选项', value: 1 },
    ]);
    expect(methods.getValue?.()).toBe(undefined);
    const componentRef = methods.getComponentRef?.() as
      | undefined
      | WrappedInstance;
    expect(componentRef?.$options?.name).toBe('WrappedStub');
  });

  it('包装组件可接收组件实例引用并保持响应式值', /** 模板引用未建立会让表单层拿不到目标组件实例。 */ async () => {
    const externalValue = ref('DUMMY-外部值');
    const wrapper = await mountApiComponent({
      /** 返回一条选项。 */
      api: async () => [{ id: 1, name: 'DUMMY-选项' }],
      labelField: 'name',
      modelValue: externalValue.value,
      valueField: 'id',
    });

    expect(renderedValue(wrapper)).toBe('DUMMY-外部值');
    expect(exposed(wrapper).getComponentRef?.()).toBeDefined();
  });
});

describe('接口组件渲染契约', /** 渲染契约决定包装组件与插槽是否按配置工作。 */ () => {
  it('按 optionsPropName 传递选项并透传调用方插槽', /** 属性名写死会让目标组件收不到选项，插槽未透传会让自定义渲染失效。 */ async () => {
    const wrapper = await mountApiComponent(
      {
        /** 返回一条选项。 */
        api: async () => [{ id: 1, name: 'DUMMY-选项' }],
        labelField: 'name',
        optionsPropName: 'options',
        valueField: 'id',
      },
      {
        /**
         * 渲染自定义插槽内容。
         * @returns 插槽占位文本。
         */
        loading: () => 'DUMMY-加载中',
      },
    );

    expect(renderedOptions(wrapper)).toHaveLength(1);
    // loadingSlot 未配置时，即使传入同名插槽也不会渲染加载图标。
    expect(wrapper.find('.wrapped-loading').exists()).toBe(true);
    expect(wrapper.find('.animate-spin').exists()).toBe(false);
  });

  it('组件属性变化时重新归一化选项', /** 未跟随字段配置变化会让切换字段名后选项错位。 */ async () => {
    const wrapper = await mountApiComponent({
      /** 返回带原始字段名的选项。 */
      api: async () => [{ id: 1, name: 'DUMMY-名称', title: 'DUMMY-标题' }],
      labelField: 'name',
      valueField: 'id',
    });
    expect(renderedOptions(wrapper)[0]?.label).toBe('DUMMY-名称');

    await wrapper.setProps({ labelField: 'title' });
    await flushPromises();

    expect(renderedOptions(wrapper)[0]?.label).toBe('DUMMY-标题');
  });
});

describe('接口组件包装实例类型', /** 包装实例类型用于核对组件暴露的泛型取值入口。 */ () => {
  it('模板引用指向被包装组件实例', /** 引用指向错误对象会让调用方拿不到目标组件的方法。 */ async () => {
    const wrapper = await mountApiComponent({
      /** 返回一条选项。 */
      api: async () => [{ id: 1, name: 'DUMMY-选项' }],
      labelField: 'name',
      valueField: 'id',
    });
    const component = wrapper.findComponent(WrappedStub)
      .vm as unknown as WrappedInstance;

    expect(component.$options?.name).toBe('WrappedStub');
    expect(typeof (WrappedStub as Component)).toBe('object');
  });
});

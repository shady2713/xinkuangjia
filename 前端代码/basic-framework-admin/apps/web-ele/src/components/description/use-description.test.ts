/**
 * 描述列表 composable（components/description/use-description）真实行为回归。
 *
 * `useDescription` 对外返回包装组件与操作实例：包装组件把响应式属性状态与透传
 * attrs 按「属性状态在前、attrs 在后」合并后交给描述列表，插槽原样透传；
 * `setDescProps` 用于异步取数后按字段合并回填。合并顺序写错会让调用方传入的
 * attrs 被业务回填的数据覆盖，插槽丢失会让描述项退化成默认取值。
 *
 * 用例只把描述列表 SFC 替换为记录型替身：它是本模块的渲染边界，真实 import 它会在
 * v8→Istanbul 重映射中产出空条目（该文件是仓库唯一的 lang="tsx" SFC，实测条目为
 * 0 语句 0 函数），使整份覆盖率证据变成 invalid-evidence；包装组件自身的属性合并、
 * 插槽透传与回填响应式逻辑保持真实实现，断言强度不变。
 */
import type { Component, VNode } from 'vue';

import type { DescriptionProps } from './typing';

import { mount } from '@vue/test-utils';
import { h, nextTick } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { useDescription } from './use-description';

/**
 * 描述项插槽：按描述项声明的 slot 名渲染，并接收当前描述数据。
 * @param params 插槽参数，含当前描述项的数据。
 * @returns 插槽渲染结果数组。
 */
type DescriptionSlot = (params: { data?: unknown }) => VNode[];

/** 描述列表替身记录的每次入参；末项即最近一次渲染收到的属性。 */
const descriptionProbe = vi.hoisted(
  /** 建立用例可清空、可断言的入参记录容器。 */ () => ({
    received: [] as Record<string, unknown>[],
  }),
);

vi.mock(
  './description.vue',
  /** 只替换描述列表渲染边界，包装组件的属性合并与插槽透传保持真实实现。 */ async () => {
    const { defineComponent: defineStub, h: createNode } = await import('vue');
    const DescriptionStub = defineStub({
      name: 'DescriptionStub',
      inheritAttrs: false,
      /**
       * 记录包装组件实际传入的属性，并渲染状态插槽以便核对插槽透传。
       * @param _props 本替身不声明属性，全部入参经 attrs 到达以完整记录合并结果。
       * @param context 组件上下文。
       * @param context.attrs 包装组件合并后传入的全部属性。
       * @param context.slots 包装组件透传的插槽表。
       * @returns 渲染函数，输出记录节点与状态插槽内容。
       */
      setup(_props, { attrs, slots }) {
        return /** 记录入参并按需渲染状态插槽。 */ () => {
          descriptionProbe.received.push({ ...attrs });
          const statusSlot = slots.statusSlot as DescriptionSlot | undefined;
          return createNode('div', { class: 'description-stub' }, [
            statusSlot
              ? createNode(
                  'span',
                  { class: 'status-slot-host' },
                  statusSlot({ data: attrs.data }),
                )
              : null,
          ]);
        };
      },
    });
    return { default: DescriptionStub };
  },
);

/** 用例使用的描述项声明：普通字段与带插槽字段。 */
const schema = [
  { field: 'name', label: '名称' },
  { field: 'status', label: '状态', slot: 'statusSlot' },
];

/** 描述项数据基线；用例按需覆盖单个字段。 */
function descriptionData() {
  return { name: '演示任务', remark: '每分钟执行一次', status: 1 };
}

/**
 * 挂载描述列表包装组件。
 * @param options 传给 useDescription 的初始属性；缺省时验证无参数契约。
 * @param attrs 挂载时透传给包装组件的非声明属性。
 * @param slots 挂载时透传给包装组件的具名插槽。
 * @returns 已挂载的包装器与操作实例。
 */
function mountDescription(
  options?: Partial<DescriptionProps>,
  attrs?: Record<string, unknown>,
  slots?: Record<
    string,
    /** 具名插槽：按描述项声明的 slot 名渲染并接收描述数据。 */
    (params: { data?: Record<string, unknown> }) => unknown
  >,
) {
  const [Wrapper, api] = useDescription(options);
  const wrapper = mount(Wrapper as Component, { attrs, slots });
  return { api, wrapper };
}

/**
 * 读取描述列表替身最近一次收到并记录下来的属性。
 * @returns 最近一次记录的属性；从未渲染时为 undefined。
 */
function latestReceivedProps() {
  return descriptionProbe.received.at(-1);
}

describe('描述列表属性合并', /** 属性状态与 attrs 的合并顺序是本模块的核心契约。 */ () => {
  it('把初始属性状态原样交给描述列表', /** 初始属性丢失会让详情页只剩标签或整块空白。 */ () => {
    descriptionProbe.received = [];
    const data = descriptionData();
    mountDescription({ border: true, column: 1, data, schema });

    expect(latestReceivedProps()).toEqual({
      border: true,
      column: 1,
      data,
      schema,
    });
  });

  it('透传 attrs 与原属性状态合并', /** attrs 丢失会让调用方无法补充标题与样式等展示信息。 */ () => {
    descriptionProbe.received = [];
    mountDescription({ column: 1 }, { title: '来自透传的标题' });

    expect(latestReceivedProps()).toEqual({
      column: 1,
      title: '来自透传的标题',
    });
  });

  it('同名键以 attrs 为准', /** 合并顺序颠倒会让调用方传入的 attrs 被业务回填值覆盖。 */ () => {
    descriptionProbe.received = [];
    mountDescription({ title: '属性状态标题' }, { title: '来自透传的标题' });

    expect(latestReceivedProps()).toMatchObject({ title: '来自透传的标题' });
  });

  it('缺省参数时提交空属性而不报错', /** 无初始属性时展开 undefined 会让渲染阶段抛错。 */ () => {
    descriptionProbe.received = [];
    const { wrapper } = mountDescription();

    expect(latestReceivedProps()).toEqual({});
    expect(wrapper.find('.description-stub').exists()).toBe(true);
  });

  it('具名插槽透传给描述列表并带上数据', /** 插槽未透传会让自定义描述项（状态标签等）退化成默认取值。 */ () => {
    descriptionProbe.received = [];
    const data = descriptionData();
    const { wrapper } = mountDescription(
      { column: 1, data, schema },
      undefined,
      {
        /** 渲染插槽并回显收到的描述数据。 */
        statusSlot: (params) => [
          h('span', { class: 'status-slot' }, `状态码:${params.data?.status}`),
        ],
      },
    );

    expect(wrapper.find('.status-slot').text()).toBe('状态码:1');
  });
});

describe('异步回填描述属性', /** 详情页在弹窗打开后才取到数据，回填必须触发真实重渲染。 */ () => {
  it('setDescProps 回填数据后重新渲染', /** 回填未生效会让详情页长期显示上一份或空白数据。 */ async () => {
    descriptionProbe.received = [];
    const { api } = mountDescription({
      column: 1,
      data: descriptionData(),
      schema,
    });
    expect(descriptionProbe.received).toHaveLength(1);

    api.setDescProps({ data: { ...descriptionData(), name: '回填后的任务' } });
    await nextTick();

    expect(descriptionProbe.received).toHaveLength(2);
    expect(latestReceivedProps()).toMatchObject({
      data: { name: '回填后的任务' },
    });
  });

  it('多次回填按字段合并而不是整体替换', /** 整体替换会让前一次回填的属性（列数、边框等）被清掉。 */ async () => {
    descriptionProbe.received = [];
    const { api } = mountDescription({ border: true, column: 1 });

    api.setDescProps({ column: 2 });
    api.setDescProps({ title: '第二次回填' });
    await nextTick();

    expect(latestReceivedProps()).toEqual({
      border: true,
      column: 2,
      title: '第二次回填',
    });
  });
});

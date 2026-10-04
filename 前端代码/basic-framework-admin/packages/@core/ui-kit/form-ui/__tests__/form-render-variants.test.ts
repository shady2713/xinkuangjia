/**
 * 表单容器渲染分支测试：布局样式、无外部表单时的提交、折叠隐藏与函数式表单项类名。
 *
 * 这些分支只在特定属性组合下出现，写错会让折叠失效、提交丢失或表单项拿到错误样式。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Form } from '../src/form-render';
import { provideComponentRefMap } from '../src/use-form-context';

/** 字段插槽内容：用普通元素替代真实控件，聚焦容器自身的渲染分支。 */
const fieldSlots = {
  /** 异常字段的占位内容。 */
  broken: () => h('input', { 'data-test': 'field-broken' }),
  /** 备注字段的占位内容。 */
  detail: () => h('input', { 'data-test': 'field-detail' }),
  /** 名称字段的占位内容。 */
  name: () => h('input', { 'data-test': 'field-name' }),
};

/**
 * 构造与真实消费方 use-form-renderer 一致的宿主：先提供控件引用表再渲染表单容器。
 * @param props 透传给表单容器的属性。
 * @returns 可直接挂载的宿主组件。
 */
function createHarness(props: Record<string, unknown>) {
  return defineComponent({
    /** 提供表单容器渲染表单项时必需的控件引用表上下文。
     * @returns 渲染表单容器的函数，属性由宿主原样透传。
     */
    setup() {
      provideComponentRefMap(new Map());
      // 本组用例只用字段插槽渲染，不经过控件解析，容器在插槽模式下不读取
      // componentMap；这里按用例属性收窄类型，控件解析路径由 form-field 用例覆盖。
      return /** 渲染被测表单容器。 */ () =>
        h(
          Form,
          props as unknown as InstanceType<typeof Form>['$props'],
          fieldSlots,
        );
    },
  });
}

/** 等待折叠计算与表单渲染收敛；折叠索引在挂载后的下一个 tick 才写入。 */
async function settle() {
  await flushPromises();
  await flushPromises();
}

/** 挂载表单容器并等待首次渲染完成。 */
async function mountForm(props: Record<string, unknown>) {
  const wrapper = mount(
    createHarness({ wrapperClass: 'probe-wrapper', ...props }),
  );
  await settle();
  return wrapper;
}

/** 两条基础字段声明，覆盖折叠判定需要的多条索引。 */
const twoFields = [
  { component: 'VbenInput', fieldName: 'name', label: '名称' },
  { component: 'VbenInput', fieldName: 'detail', label: '备注' },
];

describe('表单容器渲染分支', /** 表单容器决定所有业务表单的布局与提交入口，分支遗漏会直接体现在页面上。 */ () => {
  afterEach(
    /** 恢复被替换的 console.error，避免影响其他用例。 */ () => {
      vi.restoreAllMocks();
    },
  );

  it('inline 布局使用横向换行样式', /** 行内表单必须换行排列，否则多个筛选项会挤在一行溢出。 */ async () => {
    const wrapper = await mountForm({ layout: 'inline' });
    const container = wrapper.find('.probe-wrapper');
    expect(container.exists()).toBe(true);
    expect(container.classes()).toContain('flex-wrap');
    expect(container.classes()).toContain('gap-x-2');
    expect(container.classes()).not.toContain('flex-col');
  });

  it('默认纵向布局使用列方向样式', /** 负对照：证明上一条断言来自布局分支而不是固定类名。 */ async () => {
    const wrapper = await mountForm({});
    const container = wrapper.find('.probe-wrapper');
    expect(container.classes()).toContain('flex-col');
    expect(container.classes()).toContain('grid');
    expect(container.classes()).toContain('gap-x-4');
    expect(container.classes()).not.toContain('flex-wrap');
  });

  it('compact 模式把纵向间距收窄为 2 个单位', /** 紧凑模式用于弹窗内表单，间距必须比默认更小。 */ async () => {
    const wrapper = await mountForm({ compact: true });
    const container = wrapper.find('.probe-wrapper');
    expect(container.classes()).toContain('gap-x-2');
    expect(container.classes()).not.toContain('gap-x-4');
  });

  it('未传外部表单时内置表单提交会抛出 submit 事件', /** 独立使用时容器自己承担提交，事件丢失会让调用方收不到数据。 */ async () => {
    const wrapper = await mountForm({ schema: twoFields });
    const form = wrapper.find('form');
    expect(form.exists()).toBe(true);

    await form.trigger('submit');
    // 提交链路先做异步校验，事件在校验完成后才抛出。
    await settle();

    const emitted = wrapper.findComponent(Form).emitted('submit');
    expect(emitted).toHaveLength(1);
    expect(emitted?.[0]?.[0]).toBeTypeOf('object');
  });

  it('折叠开启时超出保留索引的表单项被隐藏', /** 折叠后只保留首行，其余项必须带上隐藏类而不是被移除。 */ async () => {
    const wrapper = await mountForm({
      collapsed: true,
      collapsedRows: 1,
      schema: twoFields,
      showCollapseButton: true,
    });
    await settle();

    expect(wrapper.findAll('[data-test="field-name"]')).toHaveLength(1);
    expect(wrapper.findAll('.hidden').length).toBeGreaterThan(0);
  });

  it('未开启折叠按钮时表单项不进入折叠计算', /** 负对照：没有折叠按钮时不得出现隐藏项，否则内容会凭空消失。 */ async () => {
    const wrapper = await mountForm({
      collapsed: true,
      collapsedRows: 1,
      schema: twoFields,
      showCollapseButton: false,
    });
    await settle();

    expect(wrapper.findAll('.hidden')).toHaveLength(0);
  });

  it('函数式表单项类名按返回值合并到表单项上', /** 业务用函数按字段状态动态给类名，返回值必须真实落到 DOM。 */ async () => {
    const wrapper = await mountForm({
      schema: [
        {
          component: 'VbenInput',
          fieldName: 'name',
          /** 返回可断言的动态类名。 */
          formItemClass: () => 'probe-dynamic-class',
          label: '名称',
        },
      ],
    });

    expect(wrapper.find('.probe-dynamic-class').exists()).toBe(true);
  });

  it('函数式表单项类名抛错时打印错误并回退为空类名', /** 单个字段的类名函数异常不能中断整表渲染，必须降级为空类名并留痕。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 屏蔽真实输出，只保留调用记录。 */ () => {});

    const wrapper = await mountForm({
      schema: [
        {
          component: 'VbenInput',
          fieldName: 'broken',
          /** 模拟业务取状态时抛出的异常。 */
          formItemClass: () => {
            throw new Error('formItemClass failed');
          },
          label: '异常字段',
        },
      ],
    });

    expect(consoleError).toHaveBeenCalledWith(
      'Error calling formItemClass function:',
      expect.any(Error),
    );
    // 异常字段仍要渲染出来，且基础类名保持存在。
    expect(wrapper.find('[data-test="field-broken"]').exists()).toBe(true);
    expect(wrapper.find('.flex-shrink-0').exists()).toBe(true);
  });
});

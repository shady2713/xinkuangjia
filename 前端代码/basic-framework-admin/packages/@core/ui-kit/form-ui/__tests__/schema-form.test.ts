/**
 * 表单渲染容器（form-ui 的 schema-form.vue）真实行为回归。
 *
 * 该容器把表单属性、折叠状态与插槽统一转交给渲染层：默认值写错会让所有使用方布局塌陷，
 * 折叠状态不同步会让“收起/展开”按钮与字段显示互相矛盾，插槽转发漏项会让调用方自定义的
 * 字段控件永远不生效。用例挂载真实容器与真实字段渲染，只把字段控件作为真实组件渲染，
 * 断言真实 DOM 上的按钮文案、字段可见性与插槽内容。
 */
import type { Component, Slots } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { useSimpleLocale } from '@vben-core/composables';

import { describe, expect, it, vi } from 'vitest';

import SchemaForm from '../src/schema-form.vue';
import { provideComponentRefMap } from '../src/use-form-context';

/**
 * 容器宿主：真实渲染容器前补齐它依赖的控件引用表上下文。
 *
 * 容器本身只负责属性与插槽转交，控件引用表由表单创建入口登记；
 * 单独挂载容器时必须按同一契约提供该上下文，否则字段渲染会因缺少注入而失败。
 */
const SchemaFormHost = defineComponent({
  name: 'SchemaFormHost',
  inheritAttrs: false,
  props: {
    /** 透传给真实容器的表单属性。 */
    formProps: { required: true, type: Object },
  },
  /**
   * 建立控件引用表上下文并渲染真实容器。
   * @param props 宿主属性，提供要透传的表单属性。
   * @param context 组件上下文，用于继续透传调用方插槽。
   * @param context.slots 调用方传入的插槽表。
   * @returns 渲染真实容器的渲染函数。
   */
  setup(props, { slots }) {
    provideComponentRefMap(new Map());
    return /** 渲染真实容器并透传表单属性与插槽。 */ () =>
      h(SchemaForm as Component, props.formProps, slots as Slots);
  },
});

/** 两条字段声明：足够产生折叠索引与插槽转发两类断言。 */
const twoFields = [
  { component: 'VbenInput', fieldName: 'name', label: '名称' },
  { component: 'VbenInput', fieldName: 'code', label: '编码' },
];

/**
 * 挂载真实表单容器。
 * @param props 表单容器属性，缺省时只提供最小 schema。
 * @param slots 调用方传入的插槽，用于核对插槽转发。
 * @returns 已挂载的组件包装器。
 */
function mountSchemaForm(
  props: Record<string, unknown> = {},
  slots?: Record<string, unknown>,
) {
  return mount(SchemaFormHost as Component, {
    props: { formProps: { schema: twoFields, ...props } },
    ...(slots ? { slots } : {}),
  });
}

/**
 * 等待容器挂载与折叠计算收敛。
 * @returns 收敛后兑现的 Promise。
 */
async function settle() {
  await flushPromises();
  await flushPromises();
}

describe('表单容器基础渲染', /** 容器是业务表单的唯一入口，属性与默认值必须落到真实 DOM。 */ () => {
  it('按 schema 渲染真实表单与字段标签', /** 字段未渲染会让所有业务表单变成空白。 */ async () => {
    const wrapper = mountSchemaForm();
    await settle();

    expect(wrapper.find('form').exists()).toBe(true);
    expect(wrapper.text()).toContain('名称');
    expect(wrapper.text()).toContain('编码');
    expect(wrapper.findAll('input')).toHaveLength(2);

    wrapper.unmount();
  });

  it('默认使用单列包裹层并显示操作按钮', /** 默认包裹类名与默认操作区缺失会让表单布局与提交流程同时失效。 */ async () => {
    const wrapper = mountSchemaForm();
    await settle();

    expect(wrapper.find('.grid-cols-1').exists()).toBe(true);
    const buttons = wrapper.findAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const $t = useSimpleLocale().$t.value;
    expect(
      buttons.map(
        /** 取出按钮可见文案，用于核对默认操作区内容。 */ (button) =>
          button.text(),
      ),
    ).toEqual(expect.arrayContaining([$t('reset'), $t('submit')]));

    wrapper.unmount();
  });

  it('关闭默认操作时不再渲染操作区', /** 页面自绘提交按钮时多出默认操作区会让提交入口重复。 */ async () => {
    const wrapper = mountSchemaForm({ showDefaultActions: false });
    await settle();

    expect(wrapper.findAll('button')).toHaveLength(0);

    wrapper.unmount();
  });
});

describe('折叠状态联动', /** 折叠状态是外部属性与内部状态的双向约定，任一侧不同步都会让用户困惑。 */ () => {
  it('点击折叠按钮回调新状态并同步按钮文案', /** 回调缺值会让页面无法记录折叠状态，内部状态不同步会让按钮文案与字段矛盾。 */ async () => {
    const handleCollapsedChange = vi.fn();
    const wrapper = mountSchemaForm({
      handleCollapsedChange,
      showCollapseButton: true,
    });
    await settle();
    const $t = useSimpleLocale().$t.value;

    expect(wrapper.text()).toContain($t('collapse'));

    await wrapper.find('.vben-link').trigger('click');
    await settle();

    expect(handleCollapsedChange).toHaveBeenCalledWith(true);
    expect(wrapper.text()).toContain($t('expand'));

    await wrapper.find('.vben-link').trigger('click');
    await settle();

    expect(handleCollapsedChange).toHaveBeenLastCalledWith(false);
    expect(wrapper.text()).toContain($t('collapse'));

    wrapper.unmount();
  });

  it('外部 collapsed 属性变化会写回内部状态', /** 页面用属性控制折叠时，内部状态不跟随会吃掉外部设置。 */ async () => {
    const wrapper = mountSchemaForm({ showCollapseButton: true });
    await settle();
    const $t = useSimpleLocale().$t.value;

    await wrapper.setProps({
      formProps: {
        collapsed: true,
        schema: twoFields,
        showCollapseButton: true,
      },
    });
    await settle();

    expect(wrapper.text()).toContain($t('expand'));

    await wrapper.setProps({
      formProps: {
        collapsed: false,
        schema: twoFields,
        showCollapseButton: true,
      },
    });
    await settle();

    expect(wrapper.text()).toContain($t('collapse'));

    wrapper.unmount();
  });

  it('未声明折叠回调时点击不抛出异常', /** 回调是可选属性，缺少时崩溃会让整页无法交互。 */ async () => {
    const wrapper = mountSchemaForm({ showCollapseButton: true });
    await settle();

    await expect(
      wrapper.find('.vben-link').trigger('click'),
    ).resolves.toBeUndefined();

    wrapper.unmount();
  });
});

describe('插槽转发', /** 插槽决定业务能否用自定义控件覆盖 schema 中的组件。 */ () => {
  it('按字段名把插槽转发到对应表单项', /** 字段插槽叫不生效会让业务只能使用内置控件。 */ async () => {
    const wrapper = mountSchemaForm(
      {},
      {
        /** 名称字段的自定义控件，用于验证按字段名转发。 */
        name: () => h('span', { 'data-test': 'custom-name' }, '自定义名称控件'),
      },
    );
    await settle();

    expect(wrapper.find('[data-test="custom-name"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="custom-name"]').text()).toBe(
      '自定义名称控件',
    );
    // 只有被覆盖的字段换成插槽，其余字段仍渲染真实控件。
    expect(wrapper.findAll('input')).toHaveLength(1);

    wrapper.unmount();
  });

  it('提供默认插槽时替换默认操作区', /** 业务自绘操作区时必须能完全接管底部区域。 */ async () => {
    const wrapper = mountSchemaForm(
      {},
      {
        /** 默认插槽内容，用于验证它会替换容器默认操作区。 */
        default: () =>
          h('span', { 'data-test': 'custom-actions' }, '自定义操作'),
      },
    );
    await settle();

    expect(wrapper.find('[data-test="custom-actions"]').exists()).toBe(true);
    expect(wrapper.findAll('button')).toHaveLength(0);

    wrapper.unmount();
  });
});

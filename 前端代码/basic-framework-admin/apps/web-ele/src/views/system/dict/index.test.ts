/**
 * 字典管理页面（views/system/dict/index.vue）的左右表格联动回归。
 *
 * 该页面把左侧字典类型表格选中的类型传给右侧字典数据表格，联动断开会让用户看到
 * 与所选类型不符的字典数据。用例替换两个子表格为最小替身，只保留真实事件与属性契约，
 * 并断言页面自身的状态写入和模板装配结果。
 */
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import DictPage from './index.vue';

vi.mock(
  '@vben/common-ui',
  /** Page 只提供应用外壳与高度上下文，与字典类型联动无关，替换为可识别的最小容器。 */ () => ({
    /** 渲染带标记的页面容器并透出插槽内容。 */
    Page: {
      name: 'PageStub',
      props: { autoContentHeight: { default: false, type: Boolean } },
      template:
        '<div data-test="page" :data-auto-content-height="String(autoContentHeight)"><slot /></div>',
    },
  }),
);

vi.mock(
  './modules/type-grid.vue',
  /** 用最小替身替换左侧字典类型表格，只保留 select 事件契约。 */ () => ({
    default: defineComponent({
      name: 'TypeGridStub',
      emits: ['select'],
      template: '<div data-test="type-grid" />',
    }),
  }),
);

vi.mock(
  './modules/data-grid.vue',
  /** 用最小替身替换右侧字典数据表格，把收到的 dictType 渲染成可断言属性。 */ () => ({
    default: defineComponent({
      name: 'DataGridStub',
      props: { dictType: { default: undefined, type: String } },
      template:
        '<div data-test="data-grid" :data-dict-type="dictType === undefined ? \'__undefined__\' : dictType" />',
    }),
  }),
);

describe('字典管理页面左右表格联动', /** 右侧数据必须跟随左侧选中的字典类型。 */ () => {
  it('初始不向数据表格传递字典类型', /** 未选择类型时不能默认取第一个类型，避免展示错误数据。 */ () => {
    const wrapper = mount(DictPage);
    const dataGrid = wrapper.findComponent({ name: 'DataGridStub' });

    expect(wrapper.find('[data-test="type-grid"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="data-grid"]').exists()).toBe(true);
    expect(dataGrid.props('dictType')).toBeUndefined();
    expect(
      wrapper.find('[data-test="data-grid"]').attributes('data-dict-type'),
    ).toBe('__undefined__');
  });

  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ () => {
    const wrapper = mount(DictPage);

    expect(
      wrapper.find('[data-test="page"]').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('选中字典类型后传递给数据表格', /** 联动入口只有 handleDictTypeSelect，事件丢失会让右侧永不刷新。 */ async () => {
    const wrapper = mount(DictPage);

    wrapper
      .findComponent({ name: 'TypeGridStub' })
      .vm.$emit('select', 'system_user_sex');
    await wrapper.vm.$nextTick();

    expect(
      wrapper.findComponent({ name: 'DataGridStub' }).props('dictType'),
    ).toBe('system_user_sex');
  });

  it('切换类型时覆盖上一次选择', /** 状态必须被替换而不是累加，否则右侧会停留在首次选择。 */ async () => {
    const wrapper = mount(DictPage);

    wrapper
      .findComponent({ name: 'TypeGridStub' })
      .vm.$emit('select', 'system_user_sex');
    await wrapper.vm.$nextTick();
    wrapper
      .findComponent({ name: 'TypeGridStub' })
      .vm.$emit('select', 'system_menu_type');
    await wrapper.vm.$nextTick();

    expect(
      wrapper.findComponent({ name: 'DataGridStub' }).props('dictType'),
    ).toBe('system_menu_type');
  });
});

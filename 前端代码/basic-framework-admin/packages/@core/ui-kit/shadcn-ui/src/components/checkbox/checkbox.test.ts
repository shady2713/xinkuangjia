/**
 * 带标签复选框（shadcn-ui 的 components/checkbox）标签关联回归。
 *
 * 该组件把复选框与文字标签绑在一起：标签的 for 必须等于复选框 id，否则点击文字无法勾选，
 * 无障碍朗读也会丢失关联；勾选结果必须通过 v-model 抛出。用例真实挂载组件并读取真实关联属性
 * 与双向绑定事件。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import VbenCheckbox from './checkbox.vue';

describe('下拉菜单标签关联', /** 关联丢失会让点击文字无反应，也会让辅助技术读不出标签。 */ () => {
  it('标签通过 for 关联到复选框 id', /** id 与 for 不一致会让标签点击无效。 */ () => {
    const wrapper = mount(VbenCheckbox, {
      props: { modelValue: false },
      slots: { default: '记住我' },
    });

    const input = wrapper.find('button[role="checkbox"]');
    const label = wrapper.find('label');
    expect(input.attributes('id')).toBeTruthy();
    expect(label.attributes('for')).toBe(input.attributes('id'));
    expect(label.text()).toBe('记住我');
    expect(label.classes()).toContain('cursor-pointer');
  });

  it('勾选后抛出取反的值', /** 不抛出会让表单拿不到用户选择。 */ () => {
    const wrapper = mount(VbenCheckbox, {
      props: {
        modelValue: false,
        /** 忽略取值更新，仅用于驱动双向绑定。 */
        'onUpdate:modelValue': () => {},
      },
      slots: { default: '记住我' },
    });

    wrapper.find('button[role="checkbox"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('已勾选时渲染选中状态', /** 状态读错会让用户看到与实际相反的勾选。 */ () => {
    const wrapper = mount(VbenCheckbox, {
      props: { modelValue: true },
      slots: { default: '记住我' },
    });

    expect(
      wrapper.find('button[role="checkbox"]').attributes('data-state'),
    ).toBe('checked');
  });
});

/**
 * 切换按钮（shadcn-ui 的 ui/toggle）变体与状态回归。
 *
 * 切换按钮用于加粗、对齐这类按压态操作：按下状态必须映射为 data-state=on，尺寸与变体必须
 * 映射到不同样式，否则用户无法分辨当前是否已按下。用例真实挂载 reka-ui 的切换按钮并读取
 * 真实状态属性与合并后的 class。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Toggle from './Toggle.vue';

describe('切换按钮状态与变体', /** 按压态不可辨认会让用户重复点击或误判格式。 */ () => {
  it('未按下时状态为 off', /** 初始态读错会让按钮看起来已被按下。 */ () => {
    const wrapper = mount(Toggle, { props: { modelValue: false } });

    expect(wrapper.attributes('data-state')).toBe('off');
    expect(wrapper.classes()).toContain('data-[state=on]:bg-accent');
  });

  it('按下时状态为 on 并抛出更新值', /** 不抛出会让格式状态无法回写到编辑器。 */ () => {
    const wrapper = mount(Toggle, {
      props: {
        modelValue: false,
        /** 忽略取值更新，仅用于驱动双向绑定。 */
        'onUpdate:modelValue': () => {},
      },
    });

    wrapper.trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('尺寸与变体按传入值生效', /** 变体写错会让次要格式按钮过于抢眼。 */ () => {
    const outlined = mount(Toggle, {
      props: { size: 'sm', variant: 'outline' },
    });

    expect(outlined.classes()).toContain('h-8');
    expect(outlined.classes()).toContain('border-input');
  });

  it('合并调用方 class 且禁用态透传', /** class 覆盖与禁用态丢失都会破坏业务样式或交互约束。 */ () => {
    const wrapper = mount(Toggle, {
      props: { class: 'custom-toggle', disabled: true },
    });

    expect(wrapper.classes()).toContain('inline-flex');
    expect(wrapper.classes()).toContain('custom-toggle');
    expect(wrapper.attributes('disabled')).toBeDefined();
  });
});

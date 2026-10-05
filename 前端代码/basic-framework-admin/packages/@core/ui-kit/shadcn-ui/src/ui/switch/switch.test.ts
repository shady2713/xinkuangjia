/**
 * 开关（shadcn-ui 的 ui/switch）交互与样式回归。
 *
 * 开关用于即时生效的布尔配置：点击必须抛出新的布尔值，受控值时不得自行改变显示状态，
 * 勾选态与未勾选态必须映射到不同背景色，否则用户无法分辨配置是否已开启。用例真实挂载
 * reka-ui 的开关根节点，读取真实的 role/aria 属性与点击后的双向绑定事件。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Switch from './Switch.vue';

describe('开关交互', /** 点击结果与受控值决定配置项能否被正确切换。 */ () => {
  it('未开启时渲染为未勾选状态', /** 初始状态读错会让用户看到与实际配置相反的开关。 */ () => {
    const wrapper = mount(Switch, { props: { modelValue: false } });

    expect(wrapper.element.tagName).toBe('BUTTON');
    expect(wrapper.attributes('role')).toBe('switch');
    expect(wrapper.attributes('aria-checked')).toBe('false');
    expect(wrapper.attributes('data-state')).toBe('unchecked');
    expect(wrapper.classes()).toContain('data-[state=unchecked]:bg-input');
  });

  it('点击时抛出取反后的值', /** 抛出原值会让开关永远停在同一状态。 */ () => {
    const wrapper = mount(Switch, {
      props: {
        modelValue: false,
        /** 忽略取值更新，仅用于驱动双向绑定。 */
        'onUpdate:modelValue': () => {},
      },
    });

    wrapper.trigger('click');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true]);
  });

  it('已开启时渲染为勾选状态', /** 勾选态样式丢失会让用户无法确认配置已生效。 */ () => {
    const wrapper = mount(Switch, { props: { modelValue: true } });

    expect(wrapper.attributes('aria-checked')).toBe('true');
    expect(wrapper.attributes('data-state')).toBe('checked');
    expect(wrapper.classes()).toContain('data-[state=checked]:bg-primary');
  });

  it('禁用时不可切换', /** 禁用态失效会让用户改动不该改的配置。 */ () => {
    const wrapper = mount(Switch, {
      props: { disabled: true, modelValue: false },
    });

    wrapper.trigger('click');

    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('合并调用方 class', /** class 被覆盖会让业务样式失效。 */ () => {
    const wrapper = mount(Switch, {
      props: { class: 'custom-switch', modelValue: false },
    });

    expect(wrapper.classes()).toContain('inline-flex');
    expect(wrapper.classes()).toContain('custom-switch');
  });
});

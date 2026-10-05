/** 按钮（shadcn-ui 的 ui/button）外观与语义契约回归。
 *
 * 按钮是所有可点击入口的基座：默认标签必须是 button 才能保留键盘与表单语义；尺寸与变体取值
 * 必须真的映射到不同样式，否则危险操作与次要操作会长得一样；as 属性决定链接形态按钮的标签；
 * 调用方的 class 必须与内置样式合并。用例真实挂载组件并读取渲染标签、语义属性与合并后的 class。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Button from './Button.vue';

describe('按钮外观与语义', /** 按钮标签与变体决定可点击入口的语义与视觉层级。 */ () => {
  it('默认渲染 button 标签并合并默认样式', /** 默认标签写错会让按钮失去键盘与表单语义。 */ () => {
    const wrapper = mount(Button, {
      props: { class: 'custom-button' },
      slots: { default: '提交' },
    });

    expect(wrapper.element.tagName).toBe('BUTTON');
    expect(wrapper.classes()).toContain('inline-flex');
    expect(wrapper.classes()).toContain('bg-primary');
    expect(wrapper.classes()).toContain('h-9');
    expect(wrapper.classes()).toContain('custom-button');
    expect(wrapper.text()).toBe('提交');
  });

  it('尺寸与变体按传入值生效', /** 尺寸写错会让工具栏按钮大小不一，变体写错会让次要操作过于抢眼。 */ () => {
    const small = mount(Button, { props: { size: 'sm', variant: 'ghost' } });
    const iconOnly = mount(Button, {
      props: { size: 'icon', variant: 'link' },
    });

    expect(small.classes()).toContain('h-8');
    expect(small.classes()).toContain('px-2');
    expect(small.classes()).toContain('hover:bg-accent');
    expect(iconOnly.classes()).toContain('w-8');
    expect(iconOnly.classes()).toContain('underline-offset-4');
  });

  it('as 属性可换标签且禁用态透传', /** 链接形态按钮需要换标签，禁用态丢失会让用户重复提交。 */ () => {
    const link = mount(Button, {
      props: { as: 'a', href: '/system/user' },
      slots: { default: '去用户管理' },
    });
    const disabled = mount(Button, {
      props: { disabled: true },
      slots: { default: '禁用' },
    });

    expect(link.element.tagName).toBe('A');
    expect(link.attributes('href')).toBe('/system/user');
    expect(disabled.attributes('disabled')).toBeDefined();
  });
});

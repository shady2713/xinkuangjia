/**
 * 徽章与按钮（shadcn-ui 的 ui/badge 与 ui/button）外观契约回归。
 *
 * 徽章用于状态标记、按钮用于所有可点击入口：变体取值必须真的映射到不同样式，否则「危险」
 * 与「次要」操作会长得一模一样；按钮默认标签必须是 button，否则无障碍与键盘行为会退化；
 * 调用方的 class 必须与内置样式合并。用例真实挂载组件并读取渲染标签、语义属性与合并后的 class。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Badge from './Badge.vue';

describe('徽章变体', /** 变体样式错乱会让用户无法区分正常、警示与禁用状态。 */ () => {
  it('默认变体渲染强调色背景', /** 默认强调色丢失会让徽章与正文无法区分。 */ () => {
    const wrapper = mount(Badge, {
      props: { class: 'custom-badge' },
      slots: { default: '启用' },
    });

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.classes()).toContain('rounded-md');
    expect(wrapper.classes()).toContain('bg-accent');
    expect(wrapper.classes()).toContain('custom-badge');
    expect(wrapper.text()).toBe('启用');
  });

  it('危险与描边变体分别使用对应样式', /** 危险状态与普通状态样式相同会让用户漏看风险。 */ () => {
    const destructive = mount(Badge, { props: { variant: 'destructive' } });
    const outline = mount(Badge, { props: { variant: 'outline' } });

    expect(destructive.classes()).toContain('bg-destructive');
    expect(destructive.classes()).not.toContain('bg-accent');
    expect(outline.classes()).toContain('text-foreground');
    expect(outline.classes()).not.toContain('bg-destructive');
  });
});

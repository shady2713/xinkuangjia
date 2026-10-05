/**
 * 卡片（shadcn-ui 的 ui/card）外观与结构回归。
 *
 * 卡片是仪表盘与详情页的基础容器：六个分区组件各自承担固定职责，调用方传入的 class 必须与
 * 内置样式合并而不是覆盖。样式合并失效会让卡片丢失边框或圆角，分区标签用错会让无障碍语义
 * 与默认排版（标题应为三级标题、描述应为段落）失配。用例真实挂载每个分区组件并读取渲染后的
 * 标签名、语义属性与合并后的 class。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Card from './Card.vue';
import CardContent from './CardContent.vue';
import CardDescription from './CardDescription.vue';
import CardFooter from './CardFooter.vue';
import CardHeader from './CardHeader.vue';
import CardTitle from './CardTitle.vue';

describe('卡片容器', /** 容器外观是卡片视觉基线，样式合并失效会让整块内容失去边界。 */ () => {
  it('渲染圆角边框容器并合并调用方 class', /** 调用方 class 被覆盖会让业务自定义布局失效。 */ () => {
    const wrapper = mount(Card, {
      props: { class: 'custom-card' },
      slots: { default: '卡片内容' },
    });

    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.classes()).toContain('rounded-xl');
    expect(wrapper.classes()).toContain('border');
    expect(wrapper.classes()).toContain('custom-card');
    expect(wrapper.text()).toBe('卡片内容');
  });
});

describe('卡片分区结构', /** 分区标签决定默认排版与无障碍语义。 */ () => {
  it('头部与底部使用块级容器并保留内边距', /** 内边距丢失会让标题贴边，用户难以区分分区。 */ () => {
    const header = mount(CardHeader, {
      props: { class: 'custom-header' },
      slots: { default: '头部' },
    });
    const footer = mount(CardFooter, {
      props: { class: 'custom-footer' },
      slots: { default: '底部' },
    });

    expect(header.element.tagName).toBe('DIV');
    expect(header.classes()).toContain('p-5');
    expect(header.classes()).toContain('custom-header');
    expect(footer.element.tagName).toBe('DIV');
    expect(footer.classes()).toContain('pt-0');
    expect(footer.classes()).toContain('custom-footer');
  });

  it('标题与描述使用语义标签', /** 标题渲染成段落会让屏幕阅读器无法按层级导航。 */ () => {
    const title = mount(CardTitle, {
      props: { class: 'custom-title' },
      slots: { default: '卡片标题' },
    });
    const description = mount(CardDescription, {
      props: { class: 'custom-description' },
      slots: { default: '卡片说明' },
    });

    expect(title.element.tagName).toBe('H3');
    expect(title.classes()).toContain('font-semibold');
    expect(title.classes()).toContain('custom-title');
    expect(title.text()).toBe('卡片标题');
    expect(description.element.tagName).toBe('P');
    expect(description.classes()).toContain('text-muted-foreground');
    expect(description.classes()).toContain('custom-description');
  });

  it('内容区保留上下内边距', /** 内容贴边会让卡片主体与标题挤在一起。 */ () => {
    const content = mount(CardContent, {
      props: { class: 'custom-content' },
      slots: { default: '内容' },
    });

    expect(content.element.tagName).toBe('DIV');
    expect(content.classes()).toContain('p-6');
    expect(content.classes()).toContain('pt-0');
    expect(content.classes()).toContain('custom-content');
  });
});

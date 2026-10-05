/**
 * 面包屑基础件（shadcn-ui 的 ui/breadcrumb）语义与结构回归。
 *
 * 面包屑由导航根节点、有序列表、层级项、当前页、分隔符与折叠占位六种基础件组成。导航根节点
 * 缺少 aria-label 会让屏幕阅读器把它读成普通容器；当前页未标记 aria-current 会让用户无法分辨
 * 自己在哪一层；折叠占位缺少可读文本会让用户以为层级缺失。用例真实挂载每个基础件并断言渲染
 * 出来的标签、语义属性与默认插槽内容。
 */
import { mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Breadcrumb from './Breadcrumb.vue';
import BreadcrumbEllipsis from './BreadcrumbEllipsis.vue';
import BreadcrumbItem from './BreadcrumbItem.vue';
import BreadcrumbLink from './BreadcrumbLink.vue';
import BreadcrumbList from './BreadcrumbList.vue';
import BreadcrumbPage from './BreadcrumbPage.vue';
import BreadcrumbSeparator from './BreadcrumbSeparator.vue';

describe('面包屑导航容器', /** 导航语义缺失会让辅助技术无法识别层级路径。 */ () => {
  it('渲染带无障碍标签的导航容器', /** 缺少 aria-label 时屏幕阅读器只会读到一组链接。 */ () => {
    const wrapper = mount(Breadcrumb, {
      props: { class: 'custom-nav' },
      slots: { default: '层级' },
    });

    expect(wrapper.element.tagName).toBe('NAV');
    expect(wrapper.attributes('aria-label')).toBe('breadcrumb');
    expect(wrapper.attributes('role')).toBe('navigation');
    expect(wrapper.classes()).toContain('custom-nav');
    expect(wrapper.text()).toBe('层级');
  });

  it('列表与层级项使用有序列表标签', /** 用普通容器会让层级顺序对辅助技术不可见。 */ () => {
    const list = mount(BreadcrumbList, {
      props: { class: 'custom-list' },
      slots: { default: '项' },
    });
    const item = mount(BreadcrumbItem, {
      props: { class: 'custom-item' },
      slots: { default: '项内容' },
    });

    expect(list.element.tagName).toBe('OL');
    expect(list.classes()).toContain('flex-wrap');
    expect(list.classes()).toContain('custom-list');
    expect(item.element.tagName).toBe('LI');
    expect(item.classes()).toContain('inline-flex');
    expect(item.classes()).toContain('custom-item');
  });

  it('当前页标记 aria-current 且不参与跳转', /** 缺少标记会让用户无法分辨当前所在层级。 */ () => {
    const wrapper = mount(BreadcrumbPage, {
      props: { class: 'custom-page' },
      slots: { default: '详情' },
    });

    expect(wrapper.element.tagName).toBe('SPAN');
    expect(wrapper.attributes('aria-current')).toBe('page');
    expect(wrapper.attributes('aria-disabled')).toBe('true');
    expect(wrapper.classes()).toContain('custom-page');
    expect(wrapper.text()).toBe('详情');
  });
});

describe('面包屑链接与分隔', /** 链接标签与分隔符决定层级是否可点击、是否可辨认。 */ () => {
  it('链接默认渲染为锚点并透传属性', /** 默认标签写错会让层级无法作为链接使用。 */ () => {
    const wrapper = mount(BreadcrumbLink, {
      props: { class: 'custom-link', href: '/system/user' },
      slots: { default: '用户管理' },
    });

    expect(wrapper.element.tagName).toBe('A');
    expect(wrapper.attributes('href')).toBe('/system/user');
    expect(wrapper.classes()).toContain('hover:text-foreground');
    expect(wrapper.classes()).toContain('custom-link');
  });

  it('分隔符默认渲染右向箭头并对辅助技术隐藏', /** 分隔符被读出会让层级路径出现噪音。 */ () => {
    const wrapper = mount(BreadcrumbSeparator, {
      props: { class: 'custom-sep' },
    });

    expect(wrapper.element.tagName).toBe('LI');
    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.attributes('role')).toBe('presentation');
    expect(wrapper.classes()).toContain('custom-sep');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('分隔符支持自定义内容', /** 业务需要文字分隔符时必须能覆盖默认图标。 */ () => {
    const wrapper = mount(BreadcrumbSeparator, {
      slots: { default: '/' },
    });

    expect(wrapper.text()).toBe('/');
  });

  it('折叠占位默认渲染省略号并提供可读文本', /** 缺少可读文本会让用户以为层级丢了一部分。 */ () => {
    const wrapper = mount(BreadcrumbEllipsis, {
      props: { class: 'custom-ellipsis' },
    });

    expect(wrapper.element.tagName).toBe('SPAN');
    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.classes()).toContain('custom-ellipsis');
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.find('.sr-only').text()).toBe('More');
  });

  it('折叠占位支持自定义内容', /** 业务需要自定义占位时必须能覆盖默认图标。 */ () => {
    const wrapper = mount(BreadcrumbEllipsis, {
      slots: { default: '...' },
    });

    expect(wrapper.text()).toContain('...');
  });
});

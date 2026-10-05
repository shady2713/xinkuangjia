/**
 * 普通菜单（menu-ui 的 components/normal-menu/normal-menu.vue）渲染与事件回归。
 *
 * 普通菜单用于横向或混合导航的图标菜单：激活项必须优先显示激活图标、非激活项显示普通图标、
 * 无图标项显示兜底图标，主题与折叠/圆角状态必须映射为真实 class。图标分支或事件载荷写错会让
 * 用户看不出当前所在页面，或让业务拿不到被点击的菜单。用例真实挂载菜单并派发真实点击与悬停。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

import { mount } from '@vue/test-utils';
import { h } from 'vue';

import { describe, expect, it } from 'vitest';

import NormalMenu from './normal-menu.vue';

/**
 * 渲染首页普通图标。
 * @returns 带真实类名的图标节点。
 */
const homeIcon = () => h('i', { class: 'icon-home' });

/**
 * 渲染首页激活图标。
 * @returns 带真实类名的激活图标节点。
 */
const homeActiveIcon = () => h('i', { class: 'icon-home-active' });

/**
 * 渲染系统管理图标。
 * @returns 带真实类名的图标节点。
 */
const settingsIcon = () => h('i', { class: 'icon-settings' });

/**
 * 菜单数据：含激活图标项、普通图标项与无图标项，覆盖全部图标分支。
 * 共享类型把图标声明为名称字符串，运行时同样接受返回节点的渲染函数，
 * 这里按组件真实支持的能力登记渲染函数，并用断言对齐声明类型。
 */
const menus: MenuRecordRaw[] = [
  {
    activeIcon: homeActiveIcon as unknown as string,
    icon: homeIcon as unknown as string,
    name: 'DUMMY-首页',
    path: '/home',
  },
  {
    icon: settingsIcon as unknown as string,
    name: 'DUMMY-系统管理',
    path: '/system',
  },
  { name: 'DUMMY-无图标菜单', path: '/plain' },
];

describe('普通菜单渲染', /** 菜单项或文案未渲染会让用户看不到任何导航入口。 */ () => {
  it('按 menus 渲染菜单项名称与图标', /** 渲染分支写错会让菜单项缺少名称或图标。 */ () => {
    const wrapper = mount(NormalMenu, { props: { activePath: '', menus } });

    expect(wrapper.element.tagName).toBe('UL');
    const items = wrapper.findAll('li');
    expect(items).toHaveLength(3);
    expect(items[0]?.text()).toContain('DUMMY-首页');
    expect(items[1]?.text()).toContain('DUMMY-系统管理');
    expect(items[2]?.text()).toContain('DUMMY-无图标菜单');
    expect(wrapper.find('.icon-home').exists()).toBe(true);
    expect(wrapper.find('.icon-settings').exists()).toBe(true);
    // 无图标项交给 VbenIcon 的兜底图标，仍然要渲染出图标容器。
    expect(items[2]?.find('.vben-normal-menu__icon').exists()).toBe(true);
  });

  it('激活项优先使用激活图标', /** 激活图标未生效会让用户看不出当前所在页面。 */ () => {
    const wrapper = mount(NormalMenu, {
      props: { activePath: '/home', menus },
    });

    const activeItem = wrapper.findAll('li')[0];
    expect(activeItem?.classes()).toContain('is-active');
    expect(activeItem?.find('.icon-home-active').exists()).toBe(true);
    expect(activeItem?.find('.icon-home').exists()).toBe(false);
  });

  it('激活项未提供激活图标时回落到普通图标', /** 回落失效会让没有激活图标的菜单项丢失图标。 */ () => {
    const wrapper = mount(NormalMenu, {
      props: { activePath: '/system', menus },
    });

    const activeItem = wrapper.findAll('li')[1];
    expect(activeItem?.classes()).toContain('is-active');
    expect(activeItem?.find('.icon-settings').exists()).toBe(true);
    expect(wrapper.findAll('li')[0]?.classes()).not.toContain('is-active');
  });
});

describe('普通菜单状态 class', /** 主题、折叠与圆角状态丢失会让菜单外观与偏好设置不一致。 */ () => {
  it('按属性映射主题、折叠与圆角 class', /** class 映射写错会让折叠菜单仍显示文字或主题错色。 */ () => {
    const wrapper = mount(NormalMenu, {
      props: {
        activePath: '',
        collapse: true,
        menus,
        rounded: true,
        theme: 'light',
      },
    });

    expect(wrapper.classes()).toContain('vben-normal-menu');
    expect(wrapper.classes()).toContain('light');
    expect(wrapper.classes()).toContain('is-light');
    expect(wrapper.classes()).toContain('is-collapse');
    expect(wrapper.classes()).toContain('is-rounded');
  });

  it('未传属性时使用空菜单与深色默认值', /** 默认值写错会让未配置主题的菜单使用错误配色或抛错。 */ () => {
    const wrapper = mount(NormalMenu);

    expect(wrapper.findAll('li')).toHaveLength(0);
    expect(wrapper.classes()).toContain('vben-normal-menu');
    expect(wrapper.classes()).toContain('dark');
    expect(wrapper.classes()).toContain('is-dark');
    expect(wrapper.classes()).not.toContain('is-collapse');
    expect(wrapper.classes()).not.toContain('is-rounded');
  });
});

describe('普通菜单事件分发', /** 事件载荷决定业务能否定位到被操作的菜单项。 */ () => {
  it('点击菜单项抛出 select 事件与该菜单项数据', /** 载荷缺失会让业务无法跳转到目标页面。 */ async () => {
    const wrapper = mount(NormalMenu, { props: { menus } });

    await wrapper.get('li:nth-child(2)').trigger('click');

    expect(wrapper.emitted('select')).toEqual([[menus[1]]]);
  });

  it('鼠标移入菜单项抛出 enter 事件与该菜单项数据', /** 载荷缺失会让悬停展开或预览逻辑拿不到目标菜单。 */ async () => {
    const wrapper = mount(NormalMenu, { props: { menus } });

    await wrapper.get('li:nth-child(1)').trigger('mouseenter');

    expect(wrapper.emitted('enter')).toEqual([[menus[0]]]);
  });
});

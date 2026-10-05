/**
 * 菜单视图（menu-ui 的 src/menu.vue，组件名 MenuView）数据装配与交互回归。
 *
 * MenuView 是业务侧唯一使用的菜单入口：它把菜单数据渲染成菜单项与子菜单，并把 MenuProps 透传给
 * 内部菜单容器。数据装配写错会让菜单项整片消失，属性透传断裂会让默认激活项、折叠态与主题失效。
 * 用例真实挂载 MenuView 与它内部的真实菜单容器、子菜单树，读取真实 DOM、激活态与事件载荷。
 */
import type { MenuRecordRaw } from '@vben-core/typings';

import { flushPromises, mount } from '@vue/test-utils';

import { describe, expect, it } from 'vitest';

import Menu from '../components/menu.vue';
import MenuView from '../menu.vue';

/** 菜单数据：一个叶子项与一个含子项的分组，覆盖菜单项与子菜单两条渲染分支。 */
const menus: MenuRecordRaw[] = [
  { icon: 'lucide:home', name: 'DUMMY-首页', path: '/home' },
  {
    children: [
      { icon: 'lucide:user', name: 'DUMMY-用户管理', path: '/system/user' },
    ],
    icon: 'lucide:settings',
    name: 'DUMMY-系统管理',
    path: '/system',
  },
];

describe('菜单视图数据装配', /** 菜单项未渲染会让整块导航消失，用户无法进入任何页面。 */ () => {
  it('按 menus 渲染叶子菜单项与子菜单', /** 装配分支写错会把分组渲染成普通项或整片丢失。 */ () => {
    const wrapper = mount(MenuView, { props: { menus } });

    expect(wrapper.find('ul.vben-menu').exists()).toBe(true);
    // 子项用 v-show 常驻 DOM，因此收起状态下顶层项与子项各渲染一个菜单项。
    expect(wrapper.findAll('.vben-menu-item')).toHaveLength(2);
    expect(wrapper.find('.vben-menu > .vben-menu-item').text()).toContain(
      'DUMMY-首页',
    );
    expect(wrapper.find('.vben-sub-menu').exists()).toBe(true);
    expect(wrapper.find('.vben-sub-menu').text()).toContain('DUMMY-系统管理');
    expect(wrapper.find('.vben-sub-menu .vben-menu-item').text()).toContain(
      'DUMMY-用户管理',
    );
    expect(wrapper.find('.vben-menu-item svg').exists()).toBe(true);
    // 分组收起时子项列表必须真实隐藏，否则用户会看到没有层级关系的菜单项。
    expect(wrapper.find('.vben-sub-menu ul').attributes('style')).toContain(
      'display: none',
    );
  });

  it('空菜单列表渲染出空容器', /** 空数据必须稳定渲染空容器，不能抛错中断整个布局。 */ () => {
    const wrapper = mount(MenuView, { props: { menus: [] } });

    expect(wrapper.find('ul.vben-menu').exists()).toBe(true);
    expect(wrapper.findAll('.vben-menu-item')).toHaveLength(0);
    expect(wrapper.find('.vben-sub-menu').exists()).toBe(false);
  });
});

describe('菜单视图属性透传', /** 属性未透传会让默认激活、折叠与主题配置全部失效。 */ () => {
  it('默认激活项透传后自动展开父级并标记激活', /** 透传断裂会让用户看不到自己当前所在的菜单。 */ async () => {
    const wrapper = mount(MenuView, {
      props: { defaultActive: '/system/user', menus },
    });
    await flushPromises();

    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');
    const activeItem = wrapper.find('.vben-menu-item.is-active');
    expect(activeItem.exists()).toBe(true);
    expect(activeItem.text()).toContain('DUMMY-用户管理');
  });

  it('折叠属性透传后菜单容器进入折叠态', /** 折叠透传断裂会让侧边栏收起后菜单仍占满宽度。 */ () => {
    const wrapper = mount(MenuView, { props: { collapse: true, menus } });

    expect(wrapper.find('ul.vben-menu').classes()).toContain('is-collapse');
  });
});

describe('菜单视图交互分发', /** 点击与展开必须被真实分发，否则导航无法跳转、分组无法展开。 */ () => {
  it('点击叶子菜单项抛出选中事件与父级路径', /** 事件缺失会让面包屑与页签标题拿不到当前层级。 */ async () => {
    const wrapper = mount(MenuView, { props: { menus } });

    await wrapper.find('.vben-menu-item').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(Menu).emitted('select')).toEqual([
      ['/home', ['/home']],
    ]);
  });

  it('点击子菜单抛出展开事件并展开子项', /** 展开事件缺失会让业务无法记录菜单使用，分组无法展开。 */ async () => {
    const wrapper = mount(MenuView, { props: { menus } });
    const subMenu = wrapper.find('.vben-sub-menu');
    expect(subMenu.classes()).not.toContain('is-opened');

    await wrapper.find('.vben-sub-menu-content').trigger('click');
    await flushPromises();

    expect(wrapper.find('.vben-sub-menu').classes()).toContain('is-opened');
    expect(wrapper.find('.vben-sub-menu ul').attributes('style')).not.toContain(
      'display: none',
    );
    expect(wrapper.findComponent(Menu).emitted('open')).toEqual([
      ['/system', ['/system']],
    ]);
  });
});

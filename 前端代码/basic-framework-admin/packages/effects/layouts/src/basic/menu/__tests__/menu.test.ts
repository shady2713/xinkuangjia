/**
 * 基础布局菜单（basic/menu/menu.vue）真实渲染与事件契约回归。
 *
 * 该组件把真实菜单数据交给菜单容器并把选中、展开事件转成对外契约：渲染丢失会让侧边导航空白，
 * 事件转发写错会让上层收不到选中菜单而无法跳转或联动，折叠相关属性不透传会让折叠侧边栏显示错乱。
 * 用例挂载真实 Menu 与真实菜单树，用真实点击与真实 DOM 断言文案、选中态、展开态与折叠态。
 */
import type { MenuRecordRaw } from '@vben/types';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { describe, expect, it } from 'vitest';

import LayoutMenu from '../menu.vue';

/** 用户管理菜单：作为系统管理下的子项，用来验证层级与展开。 */
const userMenu: MenuRecordRaw = {
  children: [],
  name: 'DUMMY-用户管理',
  parents: ['/system'],
  path: '/system/user',
};

/** 系统管理菜单：带子项，用来验证子菜单展开事件。 */
const systemMenu: MenuRecordRaw = {
  children: [userMenu],
  name: 'DUMMY-系统管理',
  path: '/system',
};

/** 工作台菜单：顶级叶子菜单，用来验证选中与折叠展示。 */
const dashboardMenu: MenuRecordRaw = {
  children: [],
  name: 'DUMMY-工作台',
  path: '/dashboard',
};

/** 菜单夹具：一条叶子菜单加一条带子项的菜单，覆盖两种渲染分支。 */
const MENUS: MenuRecordRaw[] = [dashboardMenu, systemMenu];

describe('基础布局菜单', /** 菜单渲染或事件转发出错会让用户看不到菜单或点不动菜单。 */ () => {
  it('按菜单数据渲染顶级项与子项文案', /** 菜单文案缺失会让导航入口消失。 */ () => {
    const wrapper = mount(LayoutMenu, { props: { menus: MENUS } });

    expect(wrapper.get('ul[role="menu"]').classes()).toContain('vben-menu');
    expect(wrapper.text()).toContain('DUMMY-工作台');
    expect(wrapper.text()).toContain('DUMMY-系统管理');
    expect(wrapper.text()).toContain('DUMMY-用户管理');
    // 子菜单默认收起，子项所在的容器不能带展开标记。
    expect(wrapper.get('.vben-sub-menu').classes()).not.toContain('is-opened');
  });

  it('未传菜单时渲染空菜单而不是报错', /** 菜单数据尚未加载完成时必须安全降级为空菜单。 */ () => {
    const wrapper = mount(LayoutMenu);

    expect(wrapper.findAll('li[role="menuitem"]')).toHaveLength(0);
    expect(wrapper.find('ul[role="menu"]').exists()).toBe(true);
  });

  it('点击叶子菜单抛出选中事件并携带菜单模式', /** 上层依赖该事件做路由跳转，模式缺失会让水平与垂直菜单行为混淆。 */ async () => {
    const wrapper = mount(LayoutMenu, {
      props: { menus: MENUS, mode: 'vertical' },
    });

    await wrapper.get('li[role="menuitem"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([['/dashboard', 'vertical']]);
  });

  it('点击子菜单抛出展开事件并真实展开子项', /** 展开事件丢失会让上层无法记录菜单状态，展开态不生效会让子项永远看不见。 */ async () => {
    const wrapper = mount(LayoutMenu, {
      props: { menus: MENUS, mode: 'vertical' },
    });

    await wrapper.get('.vben-sub-menu-content').trigger('click');

    expect(wrapper.emitted('open')).toEqual([['/system', ['/system']]]);
    expect(wrapper.get('.vben-sub-menu').classes()).toContain('is-opened');
  });

  it('defaultActive 指向子项时标记选中并自动展开父级', /** 选中态或自动展开失效会让用户不知道当前页面在菜单中的位置。 */ async () => {
    const wrapper = mount(LayoutMenu, {
      props: { defaultActive: '/system/user', menus: MENUS },
    });
    // 菜单项登记与自动展开在挂载后的微任务中完成，需要等待真实刷新。
    await nextTick();
    const items = wrapper.findAll('li[role="menuitem"]');
    const activeItem = items.find(
      /** 定位子项，验证深层选中态。 */ (item) =>
        item.text().includes('DUMMY-用户管理'),
    );

    expect(activeItem?.classes()).toContain('is-active');
    expect(wrapper.get('.vben-sub-menu').classes()).toContain('is-opened');
    // 非激活的顶级项不能被误标为选中。
    expect(wrapper.get('li[role="menuitem"]').classes()).not.toContain(
      'is-active',
    );
  });

  it('折叠属性透传后渲染折叠态并保留菜单名', /** 折叠侧边栏需要收起文字但仍能显示菜单名，属性漏传会让折叠样式失效。 */ () => {
    const wrapper = mount(LayoutMenu, {
      props: { collapse: true, collapseShowTitle: true, menus: MENUS },
    });
    const menu = wrapper.get('ul[role="menu"]');
    const item = wrapper.get('li[role="menuitem"]');

    expect(menu.classes()).toContain('is-collapse');
    expect(menu.classes()).toContain('is-vertical');
    expect(item.classes()).toContain('vben-menu-item');
    expect(item.classes()).toContain('is-collapse-show-title');
    // 折叠时菜单名同时出现在气泡提示与隐藏内容区，真实 DOM 中必须都能读到菜单名。
    expect(item.text()).toContain('DUMMY-工作台');
  });
});

/**
 * 混合菜单顶栏部分（basic/menu/mixed-menu.vue）真实装配与事件契约回归。
 *
 * 该组件根据当前路由在挂载前选出默认菜单与它的顶级菜单，并把普通菜单的选中、悬停事件转成对外
 * 契约：默认选中查找写错会让顶栏丢高亮或高亮到错误的顶级菜单，事件转发丢失会让上层无法切换侧边
 * 菜单。用例在真实内存路由上挂载真实 NormalMenu，用真实 DOM 与真实指针事件断言这些行为。
 */
import type { MenuRecordRaw } from '@vben/types';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { describe, expect, it } from 'vitest';

import LayoutMixedMenu from '../mixed-menu.vue';

/** 用户列表菜单：最深层菜单，用来验证按当前路径定位默认菜单。 */
const userListMenu: MenuRecordRaw = {
  children: [],
  name: 'DUMMY-用户列表',
  parents: ['/system', '/system/user'],
  path: '/system/user/list',
};

/** 用户管理菜单：中间层菜单，验证递归查找。 */
const userMenu: MenuRecordRaw = {
  children: [userListMenu],
  name: 'DUMMY-用户管理',
  parents: ['/system'],
  path: '/system/user',
};

/** 系统管理菜单：顶级菜单，验证默认选中时能定位到顶级项。 */
const systemMenu: MenuRecordRaw = {
  children: [userMenu],
  name: 'DUMMY-系统管理',
  path: '/system',
};

/** 工作台菜单：顶级叶子菜单，验证点击与悬停转发。 */
const dashboardMenu: MenuRecordRaw = {
  children: [],
  name: 'DUMMY-工作台',
  path: '/dashboard',
};

/** 菜单夹具：两层嵌套加一个顶级叶子，覆盖默认选中与顶级菜单定位。 */
const MENUS: MenuRecordRaw[] = [dashboardMenu, systemMenu];

/** 路由目标组件：导航只需真实完成，不渲染业务内容。 */
const RouteView = defineComponent({
  name: 'RouteView',
  /** 渲染最小宿主节点，证明路由导航真实落地。 */
  render: () => h('div', { 'data-test': 'route-view' }),
});

/**
 * 创建真实内存路由并停在指定地址。
 * @param path 初始导航到的地址。
 * @returns 已完成就绪导航的真实 router 实例。
 */
async function createRouterAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: RouteView, name: 'home', path: '/' },
      { component: RouteView, name: 'dashboard', path: '/dashboard' },
      { component: RouteView, name: 'user-list', path: '/system/user/list' },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

describe('混合菜单顶栏', /** 顶栏默认高亮与事件转发决定混合布局下菜单是否可用。 */ () => {
  it('当前路由命中深层菜单时抛出默认选中事件', /** 不抛默认选中会让顶栏没有高亮，携带错顶级菜单会让侧边菜单显示错误分支。 */ async () => {
    const router = await createRouterAt('/system/user/list');
    const wrapper = mount(LayoutMixedMenu, {
      global: { plugins: [router] },
      props: { menus: MENUS },
    });

    const emitted = wrapper.emitted('defaultSelect');
    expect(emitted).toHaveLength(1);
    // 菜单数据经 props 传入后是响应式代理，按结构比对真实菜单内容。
    expect(emitted?.[0]?.[0]).toEqual(userListMenu);
    expect(emitted?.[0]?.[1]).toEqual(systemMenu);
    wrapper.unmount();
  });

  it('当前路由未命中菜单时不抛默认选中事件', /** 负对照：未命中时不能凭空选中一个菜单。 */ async () => {
    const router = await createRouterAt('/');
    const wrapper = mount(LayoutMixedMenu, {
      global: { plugins: [router] },
      props: { menus: MENUS },
    });

    expect(wrapper.emitted('defaultSelect')).toBeUndefined();
    wrapper.unmount();
  });

  it('点击顶栏菜单项转发选中事件', /** 选中事件丢失会让点击顶级菜单无法切换侧边菜单。 */ async () => {
    const router = await createRouterAt('/dashboard');
    const wrapper = mount(LayoutMixedMenu, {
      global: { plugins: [router] },
      props: { menus: MENUS },
    });

    await wrapper.get('.vben-normal-menu__item').trigger('click');

    expect(wrapper.emitted('select')?.[0]?.[0]).toEqual(dashboardMenu);
    wrapper.unmount();
  });

  it('鼠标移入顶栏菜单项转发悬停事件', /** 悬停事件丢失会让鼠标经过顶级菜单时无法预览其子菜单。 */ async () => {
    const router = await createRouterAt('/dashboard');
    const wrapper = mount(LayoutMixedMenu, {
      global: { plugins: [router] },
      props: { menus: MENUS },
    });

    await wrapper.findAll('.vben-normal-menu__item')[1]?.trigger('mouseenter');

    expect(wrapper.emitted('enter')?.[0]?.[0]).toEqual(systemMenu);
    wrapper.unmount();
  });

  it('activePath 与折叠属性透传到普通菜单', /** 属性漏传会让顶栏高亮错位或折叠样式失效。 */ async () => {
    const router = await createRouterAt('/dashboard');
    const wrapper = mount(LayoutMixedMenu, {
      global: { plugins: [router] },
      props: { activePath: '/system', collapse: true, menus: MENUS },
    });
    const menu = wrapper.get('ul.vben-normal-menu');
    const items = wrapper.findAll('.vben-normal-menu__item');

    expect(menu.classes()).toContain('is-collapse');
    expect(items[0]?.classes()).not.toContain('is-active');
    expect(items[1]?.classes()).toContain('is-active');
    wrapper.unmount();
  });
});

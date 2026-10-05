/**
 * 侧边扩展菜单（basic/menu/extra-menu.vue）真实渲染、选中态与跳转回归。
 *
 * 该组件是侧边栏菜单的装配层：默认选中项取自当前路由（含 meta.activePath 覆盖），点击菜单项必须
 * 触发真实路由跳转，外观偏好需要原样透传。选中项取错会让当前页面在菜单中无高亮，跳转未接线会让
 * 菜单点不动，属性漏传会让折叠侧边栏显示异常。用例在真实内存路由上挂载真实菜单树验证这些行为。
 */
import type { RouteRecordRaw } from 'vue-router';

import type { MenuRecordRaw } from '@vben/types';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { describe, expect, it, vi } from 'vitest';

import LayoutExtraMenu from '../extra-menu.vue';

/** 用户管理菜单：验证 meta.activePath 覆盖时的深层选中。 */
const userMenu: MenuRecordRaw = {
  children: [],
  name: 'DUMMY-用户管理',
  parents: ['/system'],
  path: '/system/user',
};

/** 系统管理菜单：带子项的菜单，用于验证子项层级渲染。 */
const systemMenu: MenuRecordRaw = {
  children: [userMenu],
  name: 'DUMMY-系统管理',
  path: '/system',
};

/** 工作台菜单：顶级叶子菜单，用于验证点击跳转。 */
const dashboardMenu: MenuRecordRaw = {
  children: [],
  name: 'DUMMY-工作台',
  path: '/dashboard',
};

/** 菜单夹具：导入组件真实渲染的菜单数据。 */
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
 * @param routes 可选路由表；缺省时使用覆盖菜单路径的默认路由表。
 * @returns 已完成就绪导航的真实 router 实例。
 */
async function createRouterAt(path: string, routes?: RouteRecordRaw[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes ?? [
      { component: RouteView, name: 'home', path: '/' },
      { component: RouteView, name: 'dashboard', path: '/dashboard' },
      {
        component: RouteView,
        meta: { activePath: '/system/user', title: '用户详情' },
        name: 'user-detail',
        path: '/system/user/detail',
      },
      { component: RouteView, name: 'user', path: '/system/user' },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

describe('侧边扩展菜单', /** 菜单高亮与跳转是导航可用性的直接来源，出错会让用户迷失当前位置。 */ () => {
  it('按当前路由标记默认选中项', /** 当前页面在菜单中无高亮会让用户无法确认所处位置。 */ async () => {
    const router = await createRouterAt('/dashboard');
    const wrapper = mount(LayoutExtraMenu, {
      global: { plugins: [router] },
      props: { menus: MENUS },
    });

    expect(wrapper.get('li[role="menuitem"]').classes()).toContain('is-active');
    wrapper.unmount();
  });

  it('路由 meta.activePath 优先于当前路径标记选中项', /** 详情页需要高亮父级菜单，取错会让详情页在菜单中失去高亮。 */ async () => {
    const router = await createRouterAt('/system/user/detail');
    const wrapper = mount(LayoutExtraMenu, {
      global: { plugins: [router] },
      props: { menus: MENUS },
    });
    const items = wrapper.findAll('li[role="menuitem"]');
    const activeItem = items.find(
      /** 定位用户管理子项，验证 meta 覆盖结果。 */ (item) =>
        item.text().includes('DUMMY-用户管理'),
    );

    expect(activeItem?.classes()).toContain('is-active');
    // 顶级工作台菜单此时不应该是选中项。
    expect(items.at(0)?.classes()).not.toContain('is-active');
    wrapper.unmount();
  });

  it('点击菜单项触发真实路由跳转', /** 点击不跳转会让侧边导航完全失效。 */ async () => {
    const router = await createRouterAt('/');
    const wrapper = mount(LayoutExtraMenu, {
      global: { plugins: [router] },
      props: { menus: MENUS },
    });

    await wrapper
      .findAll('li[role="menuitem"]')
      .find(
        /** 点击工作台菜单项。 */ (item) =>
          item.text().includes('DUMMY-工作台'),
      )
      ?.trigger('click');

    await vi.waitFor(
      /** 等待异步导航真实完成后校验路由状态。 */ () => {
        expect(router.currentRoute.value.path).toBe('/dashboard');
      },
      { timeout: 2000 },
    );
    expect(router.currentRoute.value.name).toBe('dashboard');
    wrapper.unmount();
  });

  it('折叠与主题属性透传到真实菜单容器', /** 属性漏传会让折叠侧边栏显示错乱、主题色不生效。 */ async () => {
    const router = await createRouterAt('/dashboard');
    const wrapper = mount(LayoutExtraMenu, {
      global: { plugins: [router] },
      props: { collapse: true, menus: MENUS, theme: 'light' },
    });
    const menu = wrapper.get('ul[role="menu"]');

    expect(menu.classes()).toContain('is-collapse');
    expect(menu.classes()).toContain('is-light');
    expect(menu.classes()).toContain('is-vertical');
    wrapper.unmount();
  });

  it('未传菜单时渲染空菜单而不是报错', /** 菜单数据尚未返回时必须安全降级。 */ async () => {
    const router = await createRouterAt('/');
    const wrapper = mount(LayoutExtraMenu, {
      global: { plugins: [router] },
    });

    expect(wrapper.findAll('li[role="menuitem"]')).toHaveLength(0);
    expect(wrapper.find('ul[role="menu"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

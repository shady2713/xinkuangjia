/**
 * 子菜单内容（menu-ui 的 components/sub-menu-content）真实渲染回归。
 *
 * 该组件决定子菜单标题行的可见性、折叠态提示类名与箭头方向：折叠配置判错会让折叠
 * 侧边栏缺少标题或残留空白行，箭头图标选错会让展开方向与交互预期相反。用例按
 * 真实菜单上下文与属性组合挂载组件，只提供菜单上下文对象，渲染与计算逻辑保持真实。
 */
import type { Component } from 'vue';

import type { MenuProvider } from '../../types';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { createMenuContext } from '../../hooks';
import SubMenuContent from '../sub-menu-content.vue';

/**
 * 构造仅供用例使用的菜单上下文对象。
 * @param overrides 需要覆盖的菜单属性，例如折叠状态与菜单模式。
 * @param overrides.collapse 菜单是否处于折叠态。
 * @param overrides.collapseShowTitle 折叠时是否仍显示菜单名称。
 * @param overrides.mode 菜单模式，横向或纵向。
 * @param overrides.openedMenus 当前已展开的子菜单路径集合。
 * @returns 可注入后代的菜单上下文对象。
 */
function createMenuData(
  overrides: {
    collapse?: boolean;
    collapseShowTitle?: boolean;
    mode?: 'horizontal' | 'vertical';
    openedMenus?: string[];
  } = {},
) {
  return {
    activePath: '',
    /** 用例不驱动菜单项注册，仅保持接口完整。 */
    addMenuItem: vi.fn(),
    /** 用例不驱动子菜单注册，仅保持接口完整。 */
    addSubMenu: vi.fn(),
    /** 用例不驱动菜单关闭，仅保持接口完整。 */
    closeMenu: vi.fn(),
    /** 用例不驱动菜单项点击，仅保持接口完整。 */
    handleMenuItemClick: vi.fn(),
    /** 用例不驱动子菜单点击，仅保持接口完整。 */
    handleSubMenuClick: vi.fn(),
    isMenuPopup: false,
    items: {},
    openedMenus: overrides.openedMenus ?? [],
    /** 用例不驱动菜单展开，仅保持接口完整。 */
    openMenu: vi.fn(),
    props: {
      collapse: overrides.collapse ?? false,
      collapseShowTitle: overrides.collapseShowTitle ?? false,
      mode: overrides.mode ?? 'vertical',
    },
    /** 用例不驱动菜单项移除，仅保持接口完整。 */
    removeMenuItem: vi.fn(),
    /** 用例不驱动子菜单移除，仅保持接口完整。 */
    removeSubMenu: vi.fn(),
    subMenus: {},
    theme: 'dark',
  } as unknown as MenuProvider;
}

/** 菜单组件的真实注册名；查找逻辑按名称匹配祖先，夹具必须同名。 */
const MENU_COMPONENT_NAME = 'Menu';

/**
 * 建立提供菜单上下文并渲染子菜单内容的宿主组件。
 * @param menuData 需要提供给后代的菜单上下文对象。
 * @param props 透传给子菜单内容组件的属性。
 * @returns 可直接挂载的宿主组件定义。
 */
function createHost(menuData: MenuProvider, props: Record<string, unknown>) {
  return defineComponent({
    name: MENU_COMPONENT_NAME,
    /** 提供根菜单上下文并渲染子菜单内容，形成真实组件链。
     * @returns 渲染子菜单内容的渲染函数。
     */
    setup() {
      createMenuContext(menuData);
      return /** 渲染被测组件，标题通过插槽提供。 */ () =>
        h(SubMenuContent as Component, props, {
          /** 渲染可定位的子菜单标题文本。 */
          title: () => h('span', { class: 'probe-title' }, '系统管理'),
        });
    },
  });
}

/**
 * 以指定上下文与属性挂载子菜单内容组件。
 * @param menuData 菜单上下文对象。
 * @param props 透传给被测组件的属性，缺少的必填属性由本函数补齐。
 * @returns 已挂载的测试包装器。
 */
function mountContent(menuData: MenuProvider, props: Record<string, unknown>) {
  return mount(createHost(menuData, props), {
    props: { isTopLevelMenuSubmenu: false, ...props },
  });
}

describe('子菜单内容标题可见性', /** 折叠与模式组合决定标题行是否出现，判错会让折叠菜单残留空白行。 */ () => {
  it('纵向展开态显示标题行', /** 展开态必须显示子菜单名称，否则用户无法识别入口。 */ () => {
    const wrapper = mountContent(createMenuData(), { path: '/system' });

    expect(wrapper.find('.vben-sub-menu-content__title').exists()).toBe(true);
    expect(wrapper.get('.probe-title').text()).toBe('系统管理');
  });

  it('纵向折叠的一级菜单隐藏标题行', /** 折叠态一级菜单不显示名称，避免撑破窄侧边栏。 */ () => {
    const wrapper = mountContent(
      createMenuData({ collapse: true, mode: 'vertical' }),
      { level: 1, path: '/system' },
    );

    expect(wrapper.find('.vben-sub-menu-content__title').exists()).toBe(false);
  });

  it('折叠且开启折叠标题时保留标题行并标记类名', /** 后端菜单需要折叠时显示名称，必须同时给出可样式化的提示类。 */ () => {
    const wrapper = mountContent(
      createMenuData({
        collapse: true,
        collapseShowTitle: true,
        mode: 'vertical',
      }),
      { level: 1, path: '/system' },
    );

    expect(wrapper.get('div').classes()).toContain('is-collapse-show-title');
    expect(wrapper.find('.vben-sub-menu-content__title').exists()).toBe(true);
  });

  it('折叠标题配置只对一级菜单生效', /** 二级菜单不受折叠隐藏规则约束，标题行必须保留。 */ () => {
    const wrapper = mountContent(
      createMenuData({
        collapse: true,
        collapseShowTitle: true,
        mode: 'vertical',
      }),
      { level: 2, path: '/system/user' },
    );

    expect(wrapper.get('div').classes()).not.toContain(
      'is-collapse-show-title',
    );
    expect(wrapper.find('.vben-sub-menu-content__title').exists()).toBe(true);
  });
});

describe('子菜单内容箭头与图标', /** 箭头方向与可见性直接影响用户对子菜单展开状态的判断。 */ () => {
  it('纵向折叠的一级菜单隐藏箭头', /** 折叠态一级菜单没有可展开的箭头位置。 */ () => {
    const wrapper = mountContent(
      createMenuData({ collapse: true, mode: 'vertical' }),
      { level: 1, path: '/system' },
    );

    expect(
      wrapper.get('.vben-sub-menu-content__icon-arrow').attributes('style'),
    ).toContain('display: none');
  });

  it('展开的子菜单箭头旋转 180 度', /** 箭头必须反映真实展开状态，否则用户会误判当前层级。 */ () => {
    const wrapper = mountContent(createMenuData({ openedMenus: ['/system'] }), {
      level: 0,
      path: '/system',
    });

    expect(
      wrapper.get('.vben-sub-menu-content__icon-arrow').attributes('style'),
    ).toContain('rotate(180deg)');
  });

  it('未展开的子菜单箭头保持原方向', /** 负对照：未展开时不能带上旋转样式。 */ () => {
    const wrapper = mountContent(createMenuData(), {
      level: 0,
      path: '/system',
    });

    expect(
      wrapper.get('.vben-sub-menu-content__icon-arrow').attributes('style') ??
        '',
    ).not.toContain('rotate');
  });

  it('横向模式下的非一级菜单使用向右箭头', /** 横向菜单的下级入口需要向右指示，用向下箭头会误导点击方向。 */ () => {
    const wrapper = mountContent(createMenuData({ mode: 'horizontal' }), {
      level: 0,
      path: '/system',
    });

    expect(wrapper.get('.vben-sub-menu-content__icon-arrow').classes()).toEqual(
      expect.arrayContaining(['size-4']),
    );
    expect(wrapper.find('svg.lucide-chevron-right').exists()).toBe(true);
  });

  it('纵向模式下的非一级菜单使用向下箭头', /** 纵向菜单的下级入口需要向下指示。 */ () => {
    const wrapper = mountContent(createMenuData({ mode: 'vertical' }), {
      level: 0,
      path: '/system',
    });

    expect(wrapper.find('svg.lucide-chevron-down').exists()).toBe(true);
  });

  it('更多菜单项不渲染图标与箭头', /** 折叠进“更多”的入口只保留文本，多渲染图标会破坏对齐。 */ () => {
    const wrapper = mountContent(createMenuData(), {
      isMenuMore: true,
      path: '/more',
    });

    expect(wrapper.get('div').classes()).toContain('is-more');
    expect(wrapper.find('.vben-menu__icon').exists()).toBe(false);
    expect(wrapper.find('.vben-sub-menu-content__icon-arrow').exists()).toBe(
      false,
    );
  });

  it('普通子菜单渲染菜单图标占位', /** 子菜单图标由父级传入，缺少图标容器会让标题与图标错位。 */ () => {
    const wrapper = mountContent(createMenuData(), {
      icon: 'lucide:settings',
      path: '/system',
    });

    expect(wrapper.find('.vben-menu__icon').exists()).toBe(true);
  });
});

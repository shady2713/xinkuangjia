/**
 * 菜单实例查询与层级样式（use-menu.ts）的真实组件树契约回归。
 *
 * 菜单项靠 `useMenu` 向上收集父级路径链路，并在遇到 Menu 根组件时停止；`useMenuStyle`
 * 把子菜单层级换算成 CSS 变量。链路收集提前停止会漏掉路径，不停止会一直走到应用根，
 * 层级换算写错会让子菜单配色错位。用例在真实挂载的组件链上读取计算结果，
 * 不替换 getCurrentInstance 或祖先查找实现。
 */
import type { Component } from 'vue';

import type { SubMenuProvider } from '../../types';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it } from 'vitest';

import { useMenu, useMenuStyle } from '../use-menu';

/** 根菜单组件的真实注册名；祖先查找按该名称停止，夹具必须同名。 */
const MENU_NAME = 'Menu';

describe('useMenu', /** 组件实例获取、父级路径链路与最近菜单祖先。 */ () => {
  it('在组件实例之外调用时明确报错', /** 缺少实例时必须显式失败，不能让后续读取退化成 undefined。 */ () => {
    expect(
      /** 组件之外没有实例，必须直接抛出明确错误。 */ () => useMenu(),
    ).toThrow('instance is required');
  });

  it('按父级链路收集路径并在 Menu 根组件处停止', /** 提前停止会漏掉中间路径，不停止会把应用根路径拼进菜单链路。 */ () => {
    /** 记录被测组合式函数返回的响应式结果，供挂载后断言读取。 */
    const captured: { result?: ReturnType<typeof useMenu> } = {};

    const Leaf = defineComponent({
      name: 'LeafLayer',
      props: { path: { required: true, type: String } },
      /** 在真实组件实例中调用 useMenu 并记录结果。
       * @returns 渲染可定位节点的渲染函数。
       */
      setup() {
        captured.result = useMenu();
        /** 渲染叶子节点，证明结果来自真实渲染过程。 */
        const renderLeaf = () => h('span', { class: 'leaf' }, 'leaf');
        return renderLeaf;
      },
    });

    const Middle = defineComponent({
      name: 'MiddleLayer',
      props: { path: { required: true, type: String } },
      /** 渲染叶子菜单项，形成「中间层 → 叶子」的真实组件链。
       * @returns 渲染叶子菜单项的渲染函数。
       */
      setup() {
        /** 渲染携带自身路径的叶子菜单项。 */
        const renderLeaf = () => h(Leaf, { path: '/leaf' });
        return renderLeaf;
      },
    });

    const RootMenu = defineComponent({
      name: MENU_NAME,
      /** 渲染中间层菜单项；本组件名是路径收集的终止条件。
       * @returns 渲染中间层菜单项的渲染函数。
       */
      setup() {
        /** 渲染携带中间层路径的菜单项。 */
        const renderMiddle = () => h(Middle, { path: '/mid' });
        return renderMiddle;
      },
    });

    const wrapper = mount(RootMenu as Component);

    const menu = captured.result;
    expect(menu).toBeDefined();
    if (!menu) throw new Error('useMenu 未在挂载期返回结果');
    expect(wrapper.find('.leaf').exists()).toBe(true);
    expect(menu.parentPaths.value).toEqual(['/mid', '/leaf']);
    expect(menu.parentMenu.value?.type.name).toBe(MENU_NAME);
  });
});

describe('useMenuStyle', /** 子菜单层级到 CSS 变量的换算。 */ () => {
  it('没有子菜单上下文时层级为 0', /** 根菜单项不缩进，层级必须是 0 而不是 1。 */ () => {
    expect(useMenuStyle().value).toEqual({ '--menu-level': 0 });
  });

  it('有子菜单上下文时使用其层级', /** 层级直接决定缩进与配色，取错会让子菜单错位。 */ () => {
    expect(
      useMenuStyle({ level: 3 } as unknown as SubMenuProvider).value,
    ).toEqual({ '--menu-level': 3 });
  });

  it('子菜单缺少层级时回退为 1', /** 未显式声明层级的子菜单按第一层处理，不能渲染成根层级。 */ () => {
    expect(
      useMenuStyle({ level: undefined } as unknown as SubMenuProvider).value,
    ).toEqual({ '--menu-level': 1 });
  });
});

/**
 * 菜单上下文提供与注入（use-menu-context.ts）的真实组件树契约回归。
 *
 * 菜单组件通过 provide/inject 传递上下文：`createMenuContext` 建立根菜单上下文，
 * `createSubMenuContext` 按当前实例 uid 建立子菜单上下文，注入侧据此找到所属菜单。
 * 用例不替换 provide/inject，而是在真实挂载的组件链上核对注入结果的同一性与错误边界。
 */
import type { Component } from 'vue';

import type { MenuProvider, SubMenuProvider } from '../../types';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { describe, expect, it } from 'vitest';

import {
  createMenuContext,
  createSubMenuContext,
  useMenuContext,
  useSubMenuContext,
} from '../use-menu-context';

/** 菜单组件的真实注册名；`findComponentUpward` 按名称匹配祖先，夹具必须同名。 */
const MENU_NAME = 'Menu';
/** 子菜单组件的真实注册名，用于验证按父级实例隔离上下文。 */
const SUB_MENU_NAME = 'SubMenu';

/** 构造仅供用例使用的菜单上下文对象，身份由对象引用本身表达。 */
function createMenuData() {
  return { isMenuPopup: false, theme: 'dark' } as unknown as MenuProvider;
}

/** 构造仅供用例使用的子菜单上下文对象，身份由对象引用本身表达。 */
function createSubMenuData() {
  return {
    isSubMenuPopup: false,
    theme: 'light',
  } as unknown as SubMenuProvider;
}

/**
 * 创建一个注入根菜单上下文的子组件。
 * @param captured 记录注入结果与渲染完成标记的容器。
 * @returns 渲染可定位节点的组件定义。
 */
function createContextChild(captured: {
  injected?: MenuProvider;
  rendered: boolean;
}) {
  return defineComponent({
    name: 'ContextChildLayer',
    /** 在真实渲染过程中执行注入并记录结果。
     * @returns 渲染标记节点的渲染函数。
     */
    setup() {
      captured.injected = useMenuContext();
      captured.rendered = true;
      /** 渲染可定位节点，证明注入发生在真实渲染过程中。 */
      const renderChild = () => h('span', { class: 'context-child' }, 'child');
      return renderChild;
    },
  });
}

/**
 * 创建一个注入子菜单上下文的子组件。
 * @param captured 记录注入结果与渲染完成标记的容器。
 * @returns 渲染可定位节点的组件定义。
 */
function createSubMenuChild(captured: {
  injected?: SubMenuProvider;
  rendered: boolean;
}) {
  return defineComponent({
    name: 'SubMenuChildLayer',
    /** 在真实渲染过程中执行子菜单注入并记录结果。
     * @returns 渲染标记节点的渲染函数。
     */
    setup() {
      captured.injected = useSubMenuContext();
      captured.rendered = true;
      /** 渲染可定位节点，证明注入发生在真实渲染过程中。 */
      const renderChild = () => h('span', { class: 'sub-menu-child' }, 'sub');
      return renderChild;
    },
  });
}

/**
 * 创建一个只渲染单个子组件的菜单层组件。
 * @param name 组件注册名，必须与查找逻辑使用的名称一致。
 * @param child 需要渲染的子组件。
 * @returns 透传渲染子组件的组件定义。
 */
function createLayer(name: string, child: Component) {
  return defineComponent({
    name,
    /** 渲染下一层组件，形成真实组件链。
     * @returns 渲染子组件的渲染函数。
     */
    setup() {
      /** 渲染传入的子组件。 */
      const renderChild = () => h(child);
      return renderChild;
    },
  });
}

/**
 * 创建一个提供根菜单上下文并渲染子组件的宿主。
 * @param menuData 需要提供给后代的根菜单上下文对象。
 * @param child 需要渲染的子组件。
 * @returns 提供上下文并渲染子组件的组件定义。
 */
function createMenuProviderHost(menuData: MenuProvider, child: Component) {
  return defineComponent({
    name: MENU_NAME,
    /** 提供根菜单上下文并渲染子组件以触发注入。
     * @returns 渲染子组件的渲染函数。
     */
    setup() {
      createMenuContext(menuData);
      /** 渲染传入的子组件。 */
      const renderChild = () => h(child);
      return renderChild;
    },
  });
}

/**
 * 创建一个提供子菜单上下文并渲染子组件的宿主。
 * @param subMenuData 需要提供给后代的子菜单上下文对象。
 * @param child 需要渲染的子组件。
 * @returns 提供子菜单上下文并渲染子组件的组件定义。
 */
function createSubMenuProviderHost(
  subMenuData: SubMenuProvider,
  child: Component,
) {
  return defineComponent({
    name: SUB_MENU_NAME,
    /** 按当前实例 uid 提供子菜单上下文并渲染子组件。
     * @returns 渲染子组件的渲染函数。
     */
    setup() {
      createSubMenuContext(subMenuData);
      /** 渲染传入的子组件。 */
      const renderChild = () => h(child);
      return renderChild;
    },
  });
}

describe('useMenuContext 注入根菜单上下文', /** 注入失败会让菜单项无法访问菜单状态。 */ () => {
  it('子组件拿到根组件提供的同一上下文对象', /** 上下文按引用共享，复制或重建会丢失菜单状态的联动。 */ () => {
    const menuData = createMenuData();
    const captured: { injected?: MenuProvider; rendered: boolean } = {
      rendered: false,
    };

    const wrapper = mount(
      createMenuProviderHost(menuData, createContextChild(captured)),
    );

    expect(wrapper.find('.context-child').exists()).toBe(true);
    expect(captured.rendered).toBe(true);
    expect(captured.injected).toBe(menuData);
  });

  it('未处于组件上下文时抛出明确错误', /** 静默返回 undefined 会让调用方在运行期才出现空引用。 */ () => {
    expect(
      /** 在组件外直接调用被保护的注入函数。 */ () => useMenuContext(),
    ).toThrow('instance is required');
  });
});

describe('useSubMenuContext 注入子菜单上下文', /** 子菜单上下文按父级 uid 隔离，串号会让弹出子菜单读取到其它菜单的状态。 */ () => {
  it('按祖先菜单 uid 注入对应子菜单上下文', /** 注入键必须与提供键一致，否则子菜单永远读不到自身状态。 */ () => {
    const subMenuData = createSubMenuData();
    const captured: { injected?: SubMenuProvider; rendered: boolean } = {
      rendered: false,
    };

    const wrapper = mount(
      createSubMenuProviderHost(subMenuData, createSubMenuChild(captured)),
    );

    expect(wrapper.find('.sub-menu-child').exists()).toBe(true);
    expect(captured.rendered).toBe(true);
    expect(captured.injected).toBe(subMenuData);
  });

  it('祖先不是 Menu 或 SubMenu 时注入 undefined', /** 布局外使用子菜单组件时必须得到空上下文而不是报错或串号。 */ () => {
    const captured: { injected?: SubMenuProvider } = {};
    const OrphanChild = defineComponent({
      name: 'OrphanChildLayer',
      /** 在非菜单祖先中执行子菜单注入并记录结果。
       * @returns 渲染标记节点的渲染函数。
       */
      setup() {
        captured.injected = useSubMenuContext();
        /** 渲染可定位节点，证明注入发生在真实渲染过程中。 */
        const renderChild = () =>
          h('span', { class: 'orphan-child' }, 'orphan');
        return renderChild;
      },
    });

    const wrapper = mount(createLayer('PlainHostLayer', OrphanChild));

    expect(wrapper.find('.orphan-child').exists()).toBe(true);
    expect(captured.injected).toBeUndefined();
  });

  it('未处于组件上下文时抛出明确错误', /** 组件外调用没有可归属的父菜单，必须立即失败。 */ () => {
    expect(
      /** 在组件外直接调用被保护的注入函数。 */ () => useSubMenuContext(),
    ).toThrow('instance is required');
  });

  it('子菜单上下文按提供方实例隔离', /** 两个同级菜单各自提供上下文时不能互相读取。 */ () => {
    const first = createSubMenuData();
    const second = createSubMenuData();
    const seen: SubMenuProvider[] = [];
    const IsolatedChild = defineComponent({
      name: 'IsolatedChildLayer',
      /** 记录每次注入到的子菜单上下文，用于核对隔离性。
       * @returns 渲染标记节点的渲染函数。
       */
      setup() {
        const injected = useSubMenuContext();
        if (injected) seen.push(injected);
        /** 渲染可定位节点，证明注入发生在真实渲染过程中。 */
        const renderChild = () =>
          h('span', { class: 'isolated-child' }, 'isolated');
        return renderChild;
      },
    });

    mount(createSubMenuProviderHost(first, IsolatedChild));
    mount(createSubMenuProviderHost(second, IsolatedChild));

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(first);
    expect(seen[1]).toBe(second);
    expect(seen[0]).not.toBe(seen[1]);
  });
});

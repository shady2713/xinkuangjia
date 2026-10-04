/**
 * menu-ui 基础工具（utils/index.ts）的运行时契约回归。
 *
 * 两个工具都被真实菜单组件消费：`findComponentUpward` 决定子菜单/菜单项能否找到所属
 * 菜单上下文，`flattedChildren` 决定菜单插槽内容能否被正确展平后注册菜单项。这里在真实
 * 组件树上验证查找结果、未命中返回、嵌套数组与组件子树的展平顺序。
 */
import type { Component, ComponentInternalInstance, VNode } from 'vue';

import { mount } from '@vue/test-utils';
import { createVNode, defineComponent, getCurrentInstance, h } from 'vue';

import { describe, expect, it } from 'vitest';

import { findComponentUpward, flattedChildren } from '../utils';

/** 菜单组件的真实注册名；查找按名称命中祖先，夹具必须使用同名。 */
const MENU_NAME = 'Menu';
/** 子菜单组件的真实注册名，用于验证就近匹配优先于外层菜单。 */
const SUB_MENU_NAME = 'SubMenu';

/** 记录叶子组件向上查找到的祖先实例与宿主实例，供同一性断言读取。 */
const captured: {
  found?: ComponentInternalInstance | null;
  host?: ComponentInternalInstance;
} = {};

/**
 * 读取当前组件实例。
 * @returns 当前组件实例，供依赖实例的工具函数使用。
 * @throws Error 在组件 setup 之外调用时抛出，避免用例静默地什么都不验证。
 */
function requireInstance() {
  const instance = getCurrentInstance();
  if (!instance) throw new Error('用例必须在组件 setup 内查找祖先实例');
  return instance;
}

/**
 * 创建一个在 setup 中执行向上查找的叶子组件。
 * @param name 叶子组件的注册名，仅用于调试定位。
 * @param className 渲染节点类名，供用例按选择器确认组件已挂载。
 * @returns 记录查找结果并渲染标记节点的组件定义。
 */
function createLookupLeaf(name: string, className: string) {
  return defineComponent({
    name,
    /** 执行向上查找并把结果交给用例断言。
     * @returns 渲染标记节点的渲染函数。
     */
    setup() {
      captured.found = findComponentUpward(requireInstance(), [
        MENU_NAME,
        SUB_MENU_NAME,
      ]);
      /** 渲染可定位节点，证明组件链已真实挂载。 */
      const renderMarker = () => h('span', { class: className }, className);
      return renderMarker;
    },
  });
}

/**
 * 创建一个只渲染单个子组件的中间层组件。
 * @param name 中间层组件的真实注册名，查找逻辑按名称匹配祖先。
 * @param child 需要渲染的子组件。
 * @returns 透传渲染子组件的组件定义。
 */
function createMiddleLayer(name: string, child: Component) {
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
 * 创建一个记录自身实例的宿主组件。
 * @param name 宿主组件的真实注册名。
 * @param child 宿主渲染的唯一子组件。
 * @returns 记录宿主实例并渲染子组件的组件定义。
 */
function createInstanceHost(name: string, child: Component) {
  return defineComponent({
    name,
    /** 记录宿主实例，供同一性断言对比查找结果。
     * @returns 渲染子组件的渲染函数。
     */
    setup() {
      captured.host = requireInstance();
      /** 渲染传入的子组件。 */
      const renderChild = () => h(child);
      return renderChild;
    },
  });
}

/**
 * 把 vnode 或标量转换成可断言的类型标记。
 * @param node 待标记的展平结果元素，可能是 vnode、组件节点或标量。
 * @returns 元素节点返回标签名，组件节点返回组件名，标量返回其类型名。
 */
function describeNode(node: unknown) {
  if (node === null || typeof node !== 'object') return typeof node;
  const type = (node as VNode).type as unknown;
  if (typeof type === 'string') return type;
  if (typeof type === 'symbol') return 'text-vnode';
  if (typeof type === 'function') return type.name || 'anonymous-function';
  if (type && typeof type === 'object') {
    return (type as { name?: string }).name ?? 'anonymous-component';
  }
  return 'unknown-vnode';
}

describe('findComponentUpward 向上查找组件', /** 查找结果决定菜单项归属于哪个菜单上下文。 */ () => {
  it('返回最近的同名祖先实例', /** 命中最近祖先才能保证嵌套菜单不会注册到外层菜单。 */ () => {
    const TreeLeaf = createLookupLeaf('TreeLeaf', 'leaf');
    const MiddleLayer = createMiddleLayer('MiddleLayer', TreeLeaf);
    const MenuHost = createInstanceHost(MENU_NAME, MiddleLayer);

    const wrapper = mount(MenuHost);

    expect(wrapper.find('.leaf').exists()).toBe(true);
    expect(captured.found).toBe(captured.host);
    expect(captured.found?.type.name).toBe(MENU_NAME);
  });

  it('嵌套菜单返回最近的 SubMenu 而不是外层 Menu', /** 就近匹配决定子菜单上下文 uid，跨级匹配会让弹出菜单读到外层状态。 */ () => {
    const InnerLeaf = createLookupLeaf('InnerLeaf', 'nested-leaf');
    const SubMenuLayer = createInstanceHost(SUB_MENU_NAME, InnerLeaf);
    const OuterMenu = createMiddleLayer(MENU_NAME, SubMenuLayer);

    const wrapper = mount(OuterMenu);

    expect(wrapper.find('.nested-leaf').exists()).toBe(true);
    expect(captured.host?.type.name).toBe(SUB_MENU_NAME);
    expect(captured.found).toBe(captured.host);
  });

  it('没有匹配祖先时返回 null', /** 布局外使用菜单项时不能误认到无关组件作为菜单上下文。 */ () => {
    const LostLeaf = createLookupLeaf('LostLeaf', 'lost');
    const PlainHost = createMiddleLayer('PlainHostLayer', LostLeaf);

    const wrapper = mount(PlainHost);

    expect(wrapper.find('.lost').exists()).toBe(true);
    expect(captured.found).toBeNull();
  });
});

describe('flattedChildren 展平子节点', /** 展平结果直接作为菜单项注册顺序的来源。 */ () => {
  it('展平嵌套数组并保留标量', /** 插槽内容可能是任意嵌套数组，遗漏元素会丢失菜单项。 */ () => {
    const flat = flattedChildren([1, [2, [3]]]);

    expect(flat).toEqual([1, 2, 3]);
  });

  it('展平组件节点并继续展平其已渲染子树', /** 组件节点本身要保留，其渲染结果用于定位真实菜单项。 */ () => {
    const GridChild = defineComponent({
      name: 'GridChild',
      /** 渲染一个可识别的元素节点作为组件子树。
       * @returns 渲染元素节点的渲染函数。
       */
      setup() {
        /** 渲染用于定位的子节点。 */
        const renderChild = () => h('em', 'child');
        return renderChild;
      },
    });
    const FlatHost = defineComponent({
      name: 'FlatHostLayer',
      /** 渲染组件节点与文本节点混合的子树。
       * @returns 渲染混合子节点的渲染函数。
       */
      setup() {
        /** 渲染组件节点与文本节点，覆盖两类展平分支。 */
        const renderMixed = () => h('div', [h(GridChild), 'text']);
        return renderMixed;
      },
    });

    const wrapper = mount(FlatHost);
    const flat = flattedChildren(wrapper.vm.$.subTree);

    expect(
      flat.map(
        /** 逐项标记展平结果的真实类型。 */ (node) => describeNode(node),
      ),
    ).toEqual(['GridChild', 'em', 'text-vnode']);
  });

  it('无子节点也无组件实例的 vnode 原样保留', /** 空元素仍要进入结果，不能被静默丢弃。 */ () => {
    const flat = flattedChildren(createVNode('br'));

    expect(flat).toHaveLength(1);
    expect(describeNode(flat[0])).toBe('br');
  });
});

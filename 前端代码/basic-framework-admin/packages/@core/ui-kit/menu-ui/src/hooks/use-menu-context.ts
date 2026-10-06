/**
 * 菜单上下文管道：根菜单广播自身状态，子菜单按组件实例 uid 广播自身上下文。
 * useMenuContext 与 useSubMenuContext 供菜单树内部的组件取最近一层上下文。
 * 仅可在组件 setup 中调用，取不到实例时直接抛错，不返回兜底对象。
 */
import type { MenuProvider, SubMenuProvider } from '../types';

import { getCurrentInstance, inject, provide } from 'vue';

import { findComponentUpward } from '../utils';

const menuContextKey = Symbol('menuContext');

/**
 * 向后代组件下发根菜单上下文，所有层级的菜单项都从这里读激活项与展开项。
 * @zh_CN Provide menu context
 * @param injectMenuData 菜单容器用 reactive 包裹后得到的上下文对象。
 */
function createMenuContext(injectMenuData: MenuProvider) {
  provide(menuContextKey, injectMenuData);
}

/**
 * 以当前组件 uid 为键下发子菜单上下文，使下级组件能取到本层而非更外层的层级与鼠标标记。
 * @zh_CN Provide menu context
 * @param injectSubMenuData 本层子菜单对外暴露的上下文对象。
 */
function createSubMenuContext(injectSubMenuData: SubMenuProvider) {
  const instance = getCurrentInstance();

  provide(`subMenu:${instance?.uid}`, injectSubMenuData);
}

/**
 * 取根菜单上下文，菜单项与子菜单据此读取激活路径、展开集合和登记操作。
 * @zh_CN Inject menu context
 * @returns 菜单容器下发的上下文对象。
 * @throws 在 setup 之外调用、取不到当前组件实例时抛出 instance is required。
 */
function useMenuContext() {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error('instance is required');
  }
  const rootMenu = inject(menuContextKey) as MenuProvider;
  return rootMenu;
}

/**
 * 取最近一层子菜单的上下文；向上找不到 Menu 或 SubMenu 时，键值为 undefined，
 * inject 返回 undefined，调用方需自行做可选链判断。
 * @zh_CN Inject menu context
 * @returns 命中的子菜单上下文，未命中时为 undefined。
 * @throws 在 setup 之外调用、取不到当前组件实例时抛出 instance is required。
 */
function useSubMenuContext() {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error('instance is required');
  }
  const parentMenu = findComponentUpward(instance, ['Menu', 'SubMenu']);
  const subMenu = inject(`subMenu:${parentMenu?.uid}`) as SubMenuProvider;
  return subMenu;
}

export {
  createMenuContext,
  createSubMenuContext,
  useMenuContext,
  useSubMenuContext,
};

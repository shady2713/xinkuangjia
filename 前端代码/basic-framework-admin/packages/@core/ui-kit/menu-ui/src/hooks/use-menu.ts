/**
 * 菜单树读取：useMenu 给出当前项的父级链路与最近的菜单容器，
 * useMenuStyle 生成菜单层级变量，供菜单项缩进与子菜单缩进对齐使用。
 * 只读取组件树与入参，不修改展开项、激活项等任何状态。
 */
import type { SubMenuProvider } from '../types';

import { computed, getCurrentInstance } from 'vue';

import { findComponentUpward } from '../utils';

/**
 * 读取当前菜单节点在组件树中的位置：向上收集父级 path 链路，并找到最近一层菜单容器。
 * 只做只读查询，不触碰根菜单的激活项与展开项状态。
 * @returns 含父级链路与最近菜单容器实例的 ref 集合。
 * @throws 在 setup 之外调用、取不到当前组件实例时抛出 instance is required。
 */
function useMenu() {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error('instance is required');
  }

  /**
   * 从当前节点的 path 起逐级向上收集带 path 的祖先，直到遇到根 Menu 为止。
   * @zh_CN 获取所有父级菜单链路
   * @returns 由根到当前节点的 path 数组，不含没有 path 的中间层。
   */
  const parentPaths = computed(() => {
    let parent = instance.parent;
    const paths: string[] = [instance.props.path as string];
    while (parent?.type.name !== 'Menu') {
      if (parent?.props.path) {
        paths.unshift(parent.props.path as string);
      }
      parent = parent?.parent ?? null;
    }

    return paths;
  });

  /** 最近的菜单容器实例：优先命中父级 SubMenu，没有时回退到根 Menu。 */
  const parentMenu = computed(() => {
    return findComponentUpward(instance, ['Menu', 'SubMenu']);
  });

  return {
    parentMenu,
    parentPaths,
  };
}

/**
 * 生成子菜单层级缩进用的 CSS 变量，缺省不传上下文时按第 0 层处理。
 * @param menu 本层向上取到的子菜单上下文，决定 --menu-level 的取值。
 * @returns 承载 --menu-level 变量的 style 计算结果，可直接绑到子菜单容器上。
 */
function useMenuStyle(menu?: SubMenuProvider) {
  /** 把子菜单层级换算成 --menu-level，供样式表按层级累加缩进。 */
  const subMenuStyle = computed(() => {
    return {
      '--menu-level': menu ? (menu?.level ?? 0 + 1) : 0,
    };
  });
  return subMenuStyle;
}

export { useMenu, useMenuStyle };

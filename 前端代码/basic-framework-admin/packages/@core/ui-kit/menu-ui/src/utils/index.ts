/**
 * 菜单内部工具：findComponentUpward 沿组件树向上查找指定名称的祖先实例，
 * flattedChildren 递归展开插槽与组件子树，得到扁平的虚拟节点列表。
 * 两者都只读组件树，供上下文查找与水平菜单的溢出裁剪使用。
 */
import type {
  ComponentInternalInstance,
  VNode,
  VNodeChild,
  VNodeNormalizedChildren,
} from 'vue';

import { isVNode } from 'vue';

// 用 unknown[] 排除数组形态：Exclude 只关心是否为数组，不关心元素类型
type VNodeChildAtom = Exclude<VNodeChild, unknown[]>;
/** 已归一化的插槽内容：排除数组、null 与字符串后的单个可渲染子节点。 */
type RawSlots = Exclude<VNodeNormalizedChildren, null | string | unknown[]>;

/**
 * 菜单节点展开后的扁平列表：混入组件根节点与其子树的子节点，供水平菜单按宽度裁剪。
 * 保留注释节点以对齐原插槽顺序，由调用方按需过滤。
 */
type FlattenVNodes = Array<RawSlots | VNodeChildAtom>;

/**
 * 沿组件树逐级向上查找第一个名称命中 parentNames 的祖先实例，从 instance.parent 开始。
 * @zh_CN Find the parent component upward
 * @param instance 查找起点实例，不含自身。
 * @param parentNames 可接受的祖先组件名称列表。
 * @returns 命中的祖先实例；一路到根仍未命中时返回 undefined。
 */
function findComponentUpward(
  instance: ComponentInternalInstance,
  parentNames: string[],
) {
  let parent = instance.parent;
  while (parent && !parentNames.includes(parent?.type?.name ?? '')) {
    parent = parent.parent;
  }
  return parent;
}

/**
 * 递归摊平插槽内容与组件子树：数组就地展开，组件节点先保留自身再展开其 subTree。
 * @param children 插槽返回的虚拟节点、节点数组或单个虚拟节点。
 * @returns 摊平后的虚拟节点列表，元素顺序与原插槽渲染顺序一致。
 */
const flattedChildren = (
  children: FlattenVNodes | VNode | VNodeNormalizedChildren,
): FlattenVNodes => {
  const vNodes = Array.isArray(children) ? children : [children];
  const result: FlattenVNodes = [];

  vNodes.forEach((child) => {
    if (Array.isArray(child)) {
      result.push(...flattedChildren(child));
    } else if (isVNode(child) && Array.isArray(child.children)) {
      result.push(...flattedChildren(child.children));
    } else {
      result.push(child);
      if (isVNode(child) && child.component?.subTree) {
        result.push(...flattedChildren(child.component.subTree));
      }
    }
  });
  return result;
};

export { findComponentUpward, flattedChildren };

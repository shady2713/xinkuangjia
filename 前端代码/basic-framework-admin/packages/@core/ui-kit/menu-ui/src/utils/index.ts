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

type FlattenVNodes = Array<RawSlots | VNodeChildAtom>;

/**
 * @zh_CN Find the parent component upward
 * @param instance
 * @param parentNames
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

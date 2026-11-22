/**
 * 树结构构造与扁平化工具。
 */
export interface TreeNode {
  id?: number | string;
  parentId?: number | string;
  children?: TreeNode[];
  [key: string]: unknown;
}

export type TreeResult<T> = T & { children?: TreeResult<T>[] };

/**
 * 将平铺列表按 id / parentId 组装为树结构（浅拷贝节点，避免污染原始数组）。
 */
export function handleTree<T extends TreeNode>(
  list: T[],
  idKey = 'id',
  parentIdKey = 'parentId',
  childrenKey = 'children',
): TreeResult<T>[] {
  const map = new Map<string, TreeResult<T>>();
  const roots: TreeResult<T>[] = [];

  for (const item of list) {
    const cloned = { ...item } as TreeResult<T>;
    delete (cloned as Record<string, unknown>)[childrenKey];
    const key = String(cloned[idKey]);
    map.set(key, cloned);
  }

  for (const node of map.values()) {
    const parentVal = node[parentIdKey];
    const parentKey = parentVal === undefined || parentVal === null ? '' : String(parentVal);
    const parent = parentKey ? map.get(parentKey) : undefined;
    if (parent && parent !== node) {
      const bucket = ((parent as Record<string, unknown>)[childrenKey] as TreeResult<T>[] | undefined) ?? [];
      bucket.push(node);
      (parent as Record<string, unknown>)[childrenKey] = bucket;
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * 深度优先展开树节点列表。
 */
export function flattenTree<T extends TreeNode>(nodes: T[]): T[] {
  const result: T[] = [];
  const walk = (items: T[]) => {
    for (const item of items) {
      result.push(item);
      if (Array.isArray(item.children) && item.children.length > 0) {
        walk(item.children as T[]);
      }
    }
  };
  walk(nodes);
  return result;
}

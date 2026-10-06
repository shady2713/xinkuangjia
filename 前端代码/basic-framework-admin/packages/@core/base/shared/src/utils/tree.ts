/**
 * 树结构通用操作集：为路由生成、搜索面板、部门选择等场景处理嵌套数据。
 * 提供取值遍历、过滤、映射、扁平列表转树、路径名拼接与同级排序。
 * 子节点字段名可配置；不负责取数、权限过滤与节点渲染。
 */
interface TreeConfigOptions {
  // 子属性的名称，默认为'children'
  childProps: string;
}

/**
 * 把任意对象当作可按字符串键取值的记录。
 * 树结构的字段名由调用方通过 childProps 给出，静态类型无法表达，
 * 因此在唯一的取值入口做一次收窄，取到的值一律按 unknown 继续传递。
 * @param value 待取值的节点对象。
 * @returns 字段值按 unknown 暴露的记录视图。
 */
function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * 深度优先遍历树形结构，并收集每个节点上指定的值。
 * 子节点字段名可配置，取不到的层级按叶子处理，不会中断整棵树的遍历。
 * @param tree 树形结构数组
 * @param getValue 获取节点值的函数
 * @param options 作为子节点数组的可选属性名称。
 * @returns 所有节点中指定的值的数组，其中布尔为假的值会被剔除。
 */
function traverseTreeValues<T, V>(
  tree: T[],
  getValue: (node: T) => V,
  options?: TreeConfigOptions,
): V[] {
  const result: V[] = [];
  const { childProps } = options || {
    childProps: 'children',
  };

  /**
   * 递归收集当前节点及其全部后代节点的值。
   * @param treeNode 当前待处理的节点。
   */
  const dfs = (treeNode: T) => {
    const value = getValue(treeNode);
    result.push(value);
    const children = asRecord(treeNode as object)[childProps] as
      | T[]
      | undefined;
    if (!Array.isArray(children) || children.length === 0) {
      return;
    }
    for (const child of children) {
      dfs(child);
    }
  };

  for (const treeNode of tree) {
    dfs(treeNode);
  }
  return result.filter(Boolean);
}

/**
 * 根据条件过滤给定树结构的节点，并以原有顺序返回所有匹配节点的数组。
 * @param tree 要过滤的树结构的根节点数组。
 * @param filter 用于匹配每个节点的条件。
 * @param options 作为子节点数组的可选属性名称。
 * @returns 包含所有匹配节点的数组。
 */
function filterTree<T extends object>(
  tree: T[],
  filter: (node: T) => boolean,
  options?: TreeConfigOptions,
): T[] {
  const { childProps } = options || {
    childProps: 'children',
  };

  /**
   * 递归过滤一层节点，并保持原有顺序。
   * @param nodes 当前层级的节点数组。
   * @returns 命中条件且子树同样过滤后的节点数组。
   */
  const _filterTree = (nodes: T[]): T[] => {
    return nodes.filter(
      /**
       * 命中条件才保留节点，并继续过滤它的子树。
       * @param node 当前候选节点。
       * @returns 保留该节点时为 true。
       */
      (node) => {
        if (!filter(node)) {
          return false;
        }
        // 命中的节点要保留，但它的子树仍要继续过滤，否则未命中的后代会被一起留下。
        const record = asRecord(node);
        const children = record[childProps];
        if (Array.isArray(children)) {
          record[childProps] = _filterTree(children as T[]);
        }
        return true;
      },
    );
  };

  return _filterTree(tree);
}

/**
 * 根据条件重新映射给定树结构的节
 * @param tree 要过滤的树结构的根节点数组。
 * @param mapper 用于map每个节点的条件。
 * @param options 作为子节点数组的可选属性名称。
 * @returns 映射后的新树，节点形状由 mapper 决定。
 */
function mapTree<T, V extends object>(
  tree: T[],
  mapper: (node: T) => V,
  options?: TreeConfigOptions,
): V[] {
  const { childProps } = options || {
    childProps: 'children',
  };
  /**
   * 递归映射映射结果的子节点。
   * 子节点在运行时已经是映射结果 V，而 mapper 声明的入参是 T；
   * 这里用 never 做一次收窄断言把两者对齐，调用方需保证 mapper 也能处理自己的输出。
   * @param child 上一次映射产生的子节点。
   * @returns 该子节点映射后的结果。
   */
  const mapMappedChild = (child: V): V => mapper(child as never);
  return tree.map(
    /**
     * 映射单个节点，并对其子节点递归执行同一套映射。
     * @param node 当前待映射的节点。
     * @returns 映射后的新节点。
     */
    (node) => {
      const mapperNode = mapper(node);
      const record = asRecord(mapperNode);
      const children = record[childProps];
      if (Array.isArray(children)) {
        record[childProps] = mapTree<V, V>(
          children as V[],
          mapMappedChild,
          options,
        );
      }
      return mapperNode;
    },
  );
}

/**
 * 把扁平列表重组成树：按父标识分组，再从根节点递归挂上子节点数组。
 * 入参会被就地改写（补上子节点字段），调用方不应再复用同一份数据。
 * 节点类型保持与入参一致，因此部门、菜单等业务结构可以直接传进来。
 * @param data 待分组的扁平数据
 * @param id 节点标识字段，默认 'id'
 * @param parentId 父标识字段，默认 'parentId'
 * @param children 子节点数组字段，默认 'children'
 * @returns 根节点数组；入参不是数组时返回空数组并打印告警。
 */
function handleTree<T extends object>(
  data: T[],
  id: string = 'id',
  parentId: string = 'parentId',
  children: string = 'children',
): T[] {
  if (!Array.isArray(data)) {
    console.warn('data must be an array');
    return [];
  }
  const config = {
    id,
    parentId,
    childrenList: children,
  };
  const childrenListMap: Record<number | string, T[]> = {};
  const nodeIds: Record<number | string, T> = {};
  const tree: T[] = [];

  // 1. 数据预处理
  // 1.1 第一次遍历，生成 childrenListMap 和 nodeIds 映射
  for (const d of data) {
    const record = asRecord(d);
    // 标识字段由调用方指定，取值可能是数字也可能是字符串，统一按联合键处理。
    const pId = record[config.parentId] as number | string;
    if (childrenListMap[pId] === undefined) {
      childrenListMap[pId] = [];
    }
    nodeIds[record[config.id] as number | string] = d;
    childrenListMap[pId].push(d);
  }
  // 1.2 第二次遍历，找出根节点
  for (const d of data) {
    const pId = asRecord(d)[config.parentId] as number | string;
    if (nodeIds[pId] === undefined) {
      tree.push(d);
    }
  }

  // 2. 构建树结：递归构建子节点
  /**
   * 把分组结果挂回节点，并继续递归它的子节点。
   * @param node 当前待挂子节点的节点，会被就地写入子节点数组。
   */
  const adaptToChildrenList = (node: T): void => {
    const record = asRecord(node);
    const nodeId = record[config.id] as number | string;
    if (childrenListMap[nodeId]) {
      record[config.childrenList] = childrenListMap[nodeId];
      // 递归处理子节点
      for (const child of childrenListMap[nodeId]) {
        adaptToChildrenList(child);
      }
    }
  };

  // 3. 从根节点开始构建完整树
  for (const rootNode of tree) {
    adaptToChildrenList(rootNode);
  }

  return tree;
}

/** treeToString 只用到节点的标识、名称与子节点，据此收敛参数形状。 */
interface NamedTreeNode {
  children?: NamedTreeNode[];
  id: number | string;
  name?: string;
}

/**
 * 获取节点的完整结构
 * @param tree 树数据
 * @param nodeId 节点 id
 * @returns 节点名称；未命中或名称缺失时返回空串。
 */
function treeToString(tree: NamedTreeNode[], nodeId: number | string) {
  if (tree === undefined || !Array.isArray(tree) || tree.length === 0) {
    console.warn('tree must be an array');
    return '';
  }
  // 校验是否是一级节点
  const node = tree.find((item) => item.id === nodeId);
  if (node !== undefined) {
    return node.name ?? '';
  }
  let str = '';

  /**
   * 在整棵树中查找目标节点并累积其祖先路径。
   * @param arr 当前待搜索的层级。
   * @returns 找到目标节点时为 true，否则为 false。
   */
  function performAThoroughValidation(arr: NamedTreeNode[]) {
    if (arr === undefined || !Array.isArray(arr) || arr.length === 0) {
      return false;
    }
    for (const item of arr) {
      if (item.id === nodeId) {
        str += ` / ${item.name}`;
        return true;
      } else if (item.children !== undefined && item.children.length > 0) {
        str += ` / ${item.name}`;
        if (performAThoroughValidation(item.children)) {
          return true;
        }
      }
    }
    return false;
  }

  for (const item of tree) {
    str = `${item.name}`;
    if (performAThoroughValidation(item.children ?? [])) {
      break;
    }
  }
  return str;
}

/**
 * 对树形结构数据进行递归排序
 * @param treeData - 树形数据数组
 * @param sortFunction - 排序函数，用于定义排序规则
 * @param options - 配置选项，包括子节点属性名
 * @returns 排序后的树形数据
 */
function sortTree<T extends object>(
  treeData: T[],
  sortFunction: (a: T, b: T) => number,
  options?: TreeConfigOptions,
): T[] {
  const { childProps } = options || {
    childProps: 'children',
  };

  return treeData.toSorted(sortFunction).map(
    /**
     * 排好当前层后，把子节点也递归排一遍，保证整棵树顺序一致。
     * @param item 当前层的节点。
     * @returns 子节点同样有序的新节点；叶子节点原样返回。
     */
    (item) => {
      const record = asRecord(item);
      const children = record[childProps];
      if (Array.isArray(children) && children.length > 0) {
        return {
          ...item,
          [childProps]: sortTree(children as T[], sortFunction, options),
        };
      }
      return item;
    },
  );
}

export {
  filterTree,
  handleTree,
  mapTree,
  sortTree,
  traverseTreeValues,
  treeToString,
};

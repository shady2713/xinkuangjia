/** 树结构工具的测试：覆盖遍历、过滤、映射、扁平列表重组、路径定位与递归排序。 */
import { describe, expect, it, vi } from 'vitest';

import {
  filterTree,
  handleTree,
  mapTree,
  sortTree,
  traverseTreeValues,
  treeToString,
} from '../tree';

/** 按 rank 字段升序比较两个节点，供 sortTree 用例复用。
 * 入参是带 rank 数字字段的节点对象。
 * @returns rank 差值，供排序使用。
 */
function byRank(a: { rank: number }, b: { rank: number }): number {
  return a.rank - b.rank;
}

describe('traverseTreeValues', () => {
  interface Node {
    children?: Node[];
    name: string;
  }

  type NodeValue = string;

  const sampleTree: Node[] = [
    {
      name: 'A',
      children: [
        { name: 'B' },
        {
          name: 'C',
          children: [{ name: 'D' }, { name: 'E' }],
        },
      ],
    },
    {
      name: 'F',
      children: [
        { name: 'G' },
        {
          name: 'H',
          children: [{ name: 'I' }],
        },
      ],
    },
  ];

  it('traverses tree and returns all node values', () => {
    const values = traverseTreeValues<Node, NodeValue>(
      sampleTree,
      (node) => node.name,
      {
        childProps: 'children',
      },
    );
    expect(values).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
  });

  it('handles empty tree', () => {
    const values = traverseTreeValues<Node, NodeValue>([], (node) => node.name);
    expect(values).toEqual([]);
  });

  it('handles tree with only root node', () => {
    const rootNode = { name: 'A' };
    const values = traverseTreeValues<Node, NodeValue>(
      [rootNode],
      (node) => node.name,
    );
    expect(values).toEqual(['A']);
  });

  it('handles tree with only leaf nodes', () => {
    const leafNodes = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
    const values = traverseTreeValues<Node, NodeValue>(
      leafNodes,
      (node) => node.name,
    );
    expect(values).toEqual(['A', 'B', 'C']);
  });
});

describe('filterTree', () => {
  const tree = [
    {
      id: 1,
      children: [
        { id: 2 },
        { id: 3, children: [{ id: 4 }, { id: 5 }, { id: 6 }] },
        { id: 7 },
      ],
    },
    { id: 8, children: [{ id: 9 }, { id: 10 }] },
    { id: 11 },
  ];

  it('should return all nodes when condition is always true', () => {
    const result = filterTree(tree, () => true, { childProps: 'children' });
    expect(result).toEqual(tree);
  });

  it('should return only root nodes when condition is always false', () => {
    const result = filterTree(tree, () => false);
    expect(result).toEqual([]);
  });

  it('should return nodes with even id values', () => {
    const result = filterTree(tree, (node) => node.id % 2 === 0);
    expect(result).toEqual([{ id: 8, children: [{ id: 10 }] }]);
  });

  it('should return nodes with odd id values and their ancestors', () => {
    const result = filterTree(tree, (node) => node.id % 2 === 1);
    expect(result).toEqual([
      {
        id: 1,
        children: [{ id: 3, children: [{ id: 5 }] }, { id: 7 }],
      },
      { id: 11 },
    ]);
  });

  it('should return nodes with "leaf" in their name', () => {
    const tree = [
      {
        name: 'root',
        children: [
          { name: 'leaf 1' },
          {
            name: 'branch',
            children: [{ name: 'leaf 2' }, { name: 'leaf 3' }],
          },
          { name: 'leaf 4' },
        ],
      },
    ];
    const result = filterTree(
      tree,
      (node) => node.name.includes('leaf') || node.name === 'root',
    );
    expect(result).toEqual([
      {
        name: 'root',
        children: [{ name: 'leaf 1' }, { name: 'leaf 4' }],
      },
    ]);
  });
});

describe('mapTree', () => {
  it('map infinite depth tree using mapTree', () => {
    const tree = [
      {
        id: 1,
        name: 'node1',
        children: [
          { id: 2, name: 'node2' },
          { id: 3, name: 'node3' },
          {
            id: 4,
            name: 'node4',
            children: [
              {
                id: 5,
                name: 'node5',
                children: [
                  { id: 6, name: 'node6' },
                  { id: 7, name: 'node7' },
                ],
              },
              { id: 8, name: 'node8' },
            ],
          },
        ],
      },
    ];
    const newTree = mapTree(tree, (node) => ({
      ...node,
      name: `${node.name}-new`,
    }));

    expect(newTree).toEqual([
      {
        id: 1,
        name: 'node1-new',
        children: [
          { id: 2, name: 'node2-new' },
          { id: 3, name: 'node3-new' },
          {
            id: 4,
            name: 'node4-new',
            children: [
              {
                id: 5,
                name: 'node5-new',
                children: [
                  { id: 6, name: 'node6-new' },
                  { id: 7, name: 'node7-new' },
                ],
              },
              { id: 8, name: 'node8-new' },
            ],
          },
        ],
      },
    ]);
  });
});

describe('handleTree', /** 把扁平列表重组成树：按父标识分组，再从根节点递归挂上子节点。 */ () => {
  /** 部门扁平数据，handleTree 会就地补出 children。 */
  interface Dept {
    children?: Dept[];
    id: number;
    name: string;
    parentId: number;
  }

  it('builds a tree from a flat list and nests children by parentId', /** 子节点必须挂到真正的父节点下，顺序保持输入顺序。 */ () => {
    const rows: Dept[] = [
      { id: 1, name: '总部', parentId: 0 },
      { id: 2, name: '研发部', parentId: 1 },
      { id: 3, name: '前端组', parentId: 2 },
      { id: 4, name: '市场部', parentId: 1 },
    ];

    expect(handleTree(rows)).toEqual([
      {
        children: [
          {
            children: [{ id: 3, name: '前端组', parentId: 2 }],
            id: 2,
            name: '研发部',
            parentId: 1,
          },
          { id: 4, name: '市场部', parentId: 1 },
        ],
        id: 1,
        name: '总部',
        parentId: 0,
      },
    ]);
  });

  it('keeps only root nodes when no parent id matches any row', /** 找不到父节点的数据行本身就是根。 */ () => {
    const rows: Dept[] = [{ id: 9, name: '孤儿节点', parentId: 88 }];

    expect(handleTree(rows)).toEqual([
      { id: 9, name: '孤儿节点', parentId: 88 },
    ]);
  });

  it('supports custom id, parentId and children field names', /** 后端字段名可配置，逻辑不变。 */ () => {
    const rows = [
      { key: 'a', name: '根', up: '' },
      { key: 'b', name: '子', up: 'a' },
    ];

    expect(handleTree(rows, 'key', 'up', 'items')).toMatchObject([
      { items: [{ key: 'b', name: '子', up: 'a' }], key: 'a' },
    ]);
  });

  it('returns an empty array and warns for a non-array input', /** 非数组输入必须给出告警而不是抛错。 */ () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 不真正打印告警，只让 Spy 记录调用。 */ () => {});
    /** 表格组件在数据未就绪时会给出非数组值。 */
    const notAList = JSON.parse('null');

    expect(handleTree(notAList)).toEqual([]);
    expect(warn).toHaveBeenCalledWith('data must be an array');
  });

  it('returns an empty array for an empty list', /** 空数据没有根节点。 */ () => {
    expect(handleTree([])).toEqual([]);
  });
});

describe('treeToString', /** 在树里定位节点并返回其名称或祖先路径。 */ () => {
  const tree = [
    {
      children: [{ children: [{ id: 3, name: '三级' }], id: 2, name: '二级' }],
      id: 1,
      name: '一级',
    },
  ];

  it('returns the name of a top-level node', /** 一级节点直接返回名称，不带路径。 */ () => {
    expect(treeToString(tree, 1)).toBe('一级');
  });

  it('returns an empty string for a top-level node without a name', /** 缺名称时不能输出 undefined。 */ () => {
    expect(treeToString([{ id: 1 }], 1)).toBe('');
  });

  it('builds the ancestor path for a nested node', /** 深层节点要带上整条路径，否则用户看不出自己在哪。 */ () => {
    expect(treeToString(tree, 3)).toBe('一级 / 二级 / 三级');
  });

  it('returns the last visited branch name when the node is absent', /** 找不到时返回遍历到的那条分支路径，而不是空串。 */ () => {
    expect(treeToString(tree, 99)).toBe('一级 / 二级');
  });

  it('returns an empty string and warns for an empty tree', /** 空树无法查找，必须给出告警。 */ () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(/** 不真正打印告警，只让 Spy 记录调用。 */ () => {});

    expect(treeToString([], 1)).toBe('');
    expect(warn).toHaveBeenCalledWith('tree must be an array');
  });
});

describe('sortTree', /** 递归排序：当前层排好后再对子节点执行同一套排序。 */ () => {
  it('sorts every level of the tree', /** 整棵树顺序一致，不能只排根节点。 */ () => {
    const tree = [
      {
        children: [
          { id: 5, rank: 2 },
          { id: 4, rank: 1 },
          { id: 6, rank: 3 },
        ],
        id: 1,
        rank: 2,
      },
      { id: 2, rank: 1 },
      { id: 3, rank: 3 },
    ];

    const sorted = sortTree(tree, byRank);

    expect(
      sorted.map(
        /** 只比较节点标识，确认根层顺序。 */
        (node) => node.id,
      ),
    ).toEqual([2, 1, 3]);
    expect(
      sorted[1]?.children?.map(
        /** 子节点也要按同一规则排好。 */
        (node) => node.id,
      ),
    ).toEqual([4, 5, 6]);
  });

  it('leaves leaf nodes untouched', /** 叶子节点没有子节点可排，原样返回。 */ () => {
    expect(sortTree([{ id: 1, rank: 1 }], byRank)).toEqual([
      { id: 1, rank: 1 },
    ]);
  });

  it('does not mutate the input tree', /** 入参是调用方共享的数据，排序结果必须是新对象。 */ () => {
    const tree = [
      {
        children: [
          { id: 9, rank: 1 },
          { id: 8, rank: 2 },
        ],
        id: 1,
        rank: 1,
      },
      { id: 2, rank: 2 },
    ];
    const before = JSON.stringify(tree);

    sortTree(tree, byRank);

    expect(JSON.stringify(tree)).toBe(before);
  });

  it('supports a custom child field name', /** 子节点字段名可配置。 */ () => {
    const tree = [
      {
        id: 1,
        rank: 2,
        subs: [
          { id: 5, rank: 2 },
          { id: 4, rank: 1 },
        ],
      },
      { id: 2, rank: 1 },
    ];

    const sorted = sortTree(tree, byRank, { childProps: 'subs' });

    expect(
      sorted.find(
        /** 找出带自定义子节点字段的那个节点。 */
        (node) => node.subs,
      )?.subs,
    ).toEqual([
      { id: 4, rank: 1 },
      { id: 5, rank: 2 },
    ]);
  });

  it('returns an empty array for an empty tree', /** 空输入没有可排序的节点。 */ () => {
    expect(sortTree([], byRank)).toEqual([]);
  });
});

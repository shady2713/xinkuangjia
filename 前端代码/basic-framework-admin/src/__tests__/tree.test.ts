import { describe, expect, it } from 'vitest';

import { flattenTree, handleTree } from '@/utils/tree';

describe('tree utilities', () => {
  it('builds hierarchical tree without mutating original array', () => {
    const flat = [
      { id: 1, parentId: 0, name: '总部' },
      { id: 2, parentId: 1, name: '研发部' },
      { id: 3, parentId: 2, name: '平台组' },
    ];
    const tree = handleTree(flat);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('总部');
    expect(tree[0].children?.[0].name).toBe('研发部');
    expect(tree[0].children?.[0].children?.[0].name).toBe('平台组');
    expect(flattenTree(tree)).toHaveLength(3);
  });
});

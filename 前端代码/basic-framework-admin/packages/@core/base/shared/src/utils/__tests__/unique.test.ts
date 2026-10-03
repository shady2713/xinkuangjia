import { describe, expect, it } from 'vitest';

import { uniqueByField } from '../unique';

describe('uniqueByField', /** 覆盖按字段去重时保留首次出现顺序，以及空数组与单元素输入的边界。 */ () => {
  it('should return an array with unique items based on id field', () => {
    const items = [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
      { id: 1, name: 'Duplicate Item' },
    ];

    const uniqueItems = uniqueByField(items, 'id');

    expect(uniqueItems).toHaveLength(3);
    expect(uniqueItems).toEqual([
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ]);
  });

  it('should return an empty array when input array is empty', /** 元素类型与下面两处保持一致，保证 keyof T 能推导出 id 字段。 */ () => {
    const items: { id: number; name: string }[] = []; // Empty array

    const uniqueItems = uniqueByField(items, 'id');

    // Assert expected results
    expect(uniqueItems).toEqual([]);
  });

  it('should handle arrays with only one item correctly', () => {
    const items = [{ id: 1, name: 'Item 1' }];

    const uniqueItems = uniqueByField(items, 'id');

    // Assert expected results
    expect(uniqueItems).toHaveLength(1);
    expect(uniqueItems).toEqual([{ id: 1, name: 'Item 1' }]);
  });

  it('should preserve the order of the first occurrence of each item', () => {
    const items = [
      { id: 2, name: 'Item 2' },
      { id: 1, name: 'Item 1' },
      { id: 3, name: 'Item 3' },
      { id: 1, name: 'Duplicate Item' },
    ];

    const uniqueItems = uniqueByField(items, 'id');

    // Assert expected results (order of first occurrences preserved)
    expect(uniqueItems).toEqual([
      { id: 2, name: 'Item 2' },
      { id: 1, name: 'Item 1' },
      { id: 3, name: 'Item 3' },
    ]);
  });
});

/**
 * 锁定 diff 的差异口径：完全一致时返回 undefined。
 * 数组按内容集合比较，顺序无关但重复次数参与判定；
 * 只在对比对象上存在的键才进入结果，键被删除不算差异。
 */
import { describe, expect, it } from 'vitest';

import { diff } from '../diff';

describe('diff function', /** 覆盖对象差异计算在相同值、键增删与数组替换下的返回口径。 */ () => {
  it('should return an empty object when comparing identical objects', () => {
    const obj1 = { a: 1, b: { c: 2 } };
    const obj2 = { a: 1, b: { c: 2 } };
    expect(diff(obj1, obj2)).toEqual(undefined);
  });

  it('should detect simple changes in primitive values', () => {
    const obj1 = { a: 1, b: 2 };
    const obj2 = { a: 1, b: 3 };
    expect(diff(obj1, obj2)).toEqual({ b: 3 });
  });

  it('should detect nested object changes', () => {
    const obj1 = { a: 1, b: { c: 2, d: 4 } };
    const obj2 = { a: 1, b: { c: 3, d: 4 } };
    expect(diff(obj1, obj2)).toEqual({ b: { c: 3 } });
  });

  it('should handle array changes', () => {
    const obj1 = { a: [1, 2, 3], b: 2 };
    const obj2 = { a: [1, 2, 4], b: 2 };
    expect(diff(obj1, obj2)).toEqual({ a: [1, 2, 4] });
  });

  it('should handle added keys', () => {
    const obj1 = { a: 1 };
    const obj2 = { a: 1, b: 2 };
    expect(diff(obj1, obj2)).toEqual({ b: 2 });
  });

  it('should handle removed keys', () => {
    const obj1 = { a: 1, b: 2 };
    const obj2 = { a: 1 };
    expect(diff(obj1, obj2)).toEqual(undefined);
  });

  it('should handle boolean value changes', () => {
    const obj1 = { a: true, b: false };
    const obj2 = { a: true, b: true };
    expect(diff(obj1, obj2)).toEqual({ b: true });
  });

  it('should handle null and undefined values', /** diff 要求两侧同型，这里显式声明 a 的联合类型，覆盖 null 变为 number 的变化。 */ () => {
    const obj1: { a: null | number; b: undefined } = { a: null, b: undefined };
    const obj2: { a: null | number; b: undefined } = { a: 1, b: undefined };
    expect(diff(obj1, obj2)).toEqual({ a: 1 });
  });

  it('should return undefined for identical arrays', /** 数组内容一致时按整体判定为无差异，不逐项递归。 */ () => {
    const obj1 = { a: [1, 2, 3] };
    const obj2 = { a: [1, 2, 3] };
    expect(diff(obj1, obj2)).toEqual(undefined);
  });

  it('should return undefined for the same items in a different order', /** 数组按内容集合比较，与顺序无关。 */ () => {
    const obj1 = { a: [1, 2, 3] };
    const obj2 = { a: [3, 2, 1] };
    expect(diff(obj1, obj2)).toEqual(undefined);
  });

  it('should detect a repeated-item mismatch', /** 长度相同但重复次数不同仍应判定为有差异。 */ () => {
    const obj1 = { a: [1, 1, 2] };
    const obj2 = { a: [1, 2, 2] };
    expect(diff(obj1, obj2)).toEqual({ a: [1, 2, 2] });
  });
});

/**
 * 应用级数组工具（apps/web-ele 的 utils/index）真实行为回归。
 *
 * `findIndex` 是给旧浏览器准备的 `Array.prototype.findIndex` 包装：原生实现存在时必须原样
 * 转发三个回调参数并保持短路语义；缺失时必须退化到 `some` 遍历且行为一致，否则界面上的
 * 查找结果会与原生不一致。用例分别用真实数组与缺少 `findIndex` 的类数组对象驱动两条分支，
 * 断言返回值、回调参数与短路次数。
 */
import { describe, expect, it } from 'vitest';

import { findIndex } from './index';

/**
 * 构造缺少 `findIndex` 的类数组对象，用于驱动兼容分支。
 * @param values 依次作为下标元素的值。
 * @returns 只有下标、length 与 some 的类数组对象。
 */
function arrayLikeWithoutFindIndex(values: string[]) {
  const arrayLike: Record<number | string, unknown> = {
    length: values.length,
    some: Array.prototype.some,
  };
  values.forEach(
    /** 按真实下标写入元素，保证遍历顺序与数组一致。 */ (value, index) => {
      arrayLike[index] = value;
    },
  );
  return arrayLike as unknown as string[];
}

describe('findIndex', /** 原生分支与兼容分支必须给出相同结果。 */ () => {
  it('命中时返回下标并原样转发三个回调参数', /** 参数缺失会让按下标或原数组判定的回调失效。 */ () => {
    const seen: [string, number, string[]][] = [];
    const list = ['a', 'b', 'c'];

    const index = findIndex(
      list,
      /** 记录真实入参并只命中第二个元素。 */ (item, itemIndex, array) => {
        seen.push([item, itemIndex, array]);
        return item === 'b';
      },
    );

    expect(index).toBe(1);
    expect(seen).toEqual([
      ['a', 0, list],
      ['b', 1, list],
    ]);
  });

  it('未命中时返回 -1', /** 返回 undefined 会让调用方把未命中当成下标 0。 */ () => {
    expect(
      findIndex(['a'], /** 恒定不命中，用于验证未命中返回值。 */ () => false),
    ).toBe(-1);
    expect(findIndex([], /** 空数组上不应调用回调。 */ () => true)).toBe(-1);
  });

  it('缺少原生 findIndex 时退化遍历并返回相同下标', /** 兼容分支失效会让旧浏览器上的查找整体不可用。 */ () => {
    const arrayLike = arrayLikeWithoutFindIndex(['a', 'b', 'c']);
    const seen: [string, number, string[]][] = [];

    const index = findIndex(
      arrayLike,
      /** 记录真实入参并只命中第三个元素。 */ (item, itemIndex, array) => {
        seen.push([item, itemIndex, array]);
        return item === 'c';
      },
    );

    expect(index).toBe(2);
    expect(seen).toEqual([
      ['a', 0, arrayLike],
      ['b', 1, arrayLike],
      ['c', 2, arrayLike],
    ]);
  });

  it('兼容分支命中后立即停止遍历', /** 不短路会让判定回调产生额外副作用并浪费遍历。 */ () => {
    const arrayLike = arrayLikeWithoutFindIndex(['a', 'b', 'c']);
    let calls = 0;

    const index = findIndex(
      arrayLike,
      /** 统计真实调用次数，命中第二个元素后应停止。 */ () => {
        calls += 1;
        return calls === 2;
      },
    );

    expect(index).toBe(1);
    expect(calls).toBe(2);
  });

  it('兼容分支未命中时返回 -1', /** 兼容分支的兜底返回值写错会让调用方拿到无效下标。 */ () => {
    const arrayLike = arrayLikeWithoutFindIndex(['a', 'b']);

    expect(
      findIndex(arrayLike, /** 恒定不命中，用于验证兜底返回值。 */ () => false),
    ).toBe(-1);
  });
});

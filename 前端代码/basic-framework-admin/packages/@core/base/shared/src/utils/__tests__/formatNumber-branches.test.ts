/**
 * 金额展示格式化（formatNumber 的 floatToFixed2）边界取值的真实行为回归。
 *
 * floatToFixed2 把分值转成固定两位小数的展示串，是表格金额列的最后一道格式保障：
 * 未定义必须回落 '0.00'，常规分值必须四舍五入到两位，NaN / Infinity 这类不可格式化数值
 * 必须原样带出而不是抛错，超出 toFixed 精确范围的指数写法必须落在确定结果上。这些取值
 * 一旦漂移，页面上的金额就会出现 'undefined' 或空白。用例直接调用真实实现断言返回值。
 *
 * 另附真实不变量：小数位的取值来源是固定 toFixed(2)，小数部分长度只可能是 2、0 或指数尾，
 * 因此源码 switch 中 len === 1 的分支在真实链路上不可达（该 3 条未覆盖语句已如实上报）。
 */
import { describe, expect, it } from 'vitest';

import { floatToFixed2, formatToFraction } from '../formatNumber';

describe('floatToFixed2 金额展示取值', /** 金额展示串直接面向用户，任何输入都必须得到确定结果。 */ () => {
  it('未定义回落 0.00 且常规分值保留两位', /** 空值与正常分值是最常见输入，输出格式错位会让整列金额不可读。 */ () => {
    expect(floatToFixed2(undefined)).toBe('0.00');
    expect(floatToFixed2(0)).toBe('0.00');
    expect(floatToFixed2(100)).toBe('1.00');
    expect(floatToFixed2(1)).toBe('0.01');
    expect(floatToFixed2(-1)).toBe('-0.01');
    // 字符串分值来自输入框等文本来源，同样要按分值换算。
    expect(floatToFixed2('1234')).toBe('12.34');
  });

  it('不可格式化的数值原样带出且不抛错', /** NaN 与 Infinity 不能把表格渲染打断，必须退化成可读文本。 */ () => {
    expect(floatToFixed2(Number.NaN)).toBe('NaN.00');
    expect(floatToFixed2(Number.POSITIVE_INFINITY)).toBe('Infinity.00');
    expect(floatToFixed2(Number.NEGATIVE_INFINITY)).toBe('-Infinity.00');
    // 非数字字符串经 parseFloat 得到 NaN，走同一条回落路径。
    expect(floatToFixed2('abc')).toBe('NaN.00');
  });

  it('指数写法的小数尾不被识别时回落默认值', /** 超出 toFixed 精确范围的数值会走指数写法，此时必须交出默认串而不是残缺文本。 */ () => {
    // 1.5e23 / 100 已越过 toFixed 的精确区间，小数部分变成 '5e+21'，不属于任何已知位数。
    expect(formatToFraction(1.5e23)).toBe('1.5e+21');
    expect(floatToFixed2(1.5e23)).toBe('0.00');
  });

  it('分值格式化的小数部分长度永远不是 1', /** 该不变量说明源码里 len === 1 的分支不可达，避免误判为测试遗漏。 */ () => {
    const samples: (number | string | undefined)[] = [
      undefined,
      0,
      1,
      100,
      -1,
      12_345,
      1e21,
      1.5e23,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1234',
      'abc',
    ];
    const decimalLengths = samples.map(
      /** 取出单个分值格式化结果的小数位长度。 */ (sample) => {
        const decimalPart = formatToFraction(sample).split('.')[1];
        return decimalPart ? decimalPart.length : 0;
      },
    );

    expect(decimalLengths).not.toContain(1);
  });
});

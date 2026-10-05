/**
 * 金额展示格式化（formatNumber 的 floatToFixed2）边界取值的真实行为回归。
 *
 * floatToFixed2 把分值转成固定两位小数的展示串，是表格金额列的最后一道格式保障：
 * 未定义必须回落 '0.00'，常规分值必须四舍五入到两位，NaN / Infinity 这类不可格式化数值
 * 必须原样带出而不是抛错，超出 toFixed 精确范围的指数写法必须落在确定结果上。这些取值
 * 一旦漂移，页面上的金额就会出现 'undefined' 或空白。用例直接调用真实实现断言返回值。
 *
 * 另附真实不变量：小数位的取值来源是固定 toFixed(2)，小数部分长度只可能是 2、0 或指数尾。
 * 该不变量说明「1 位小数」在 floatToFixed2 的真实入参下不会出现，但补齐规则本身必须完整。
 * 按 [裁决 D9] 的口径，补齐动作已提取为接收显式小数位数的 padFractionToTwoDigits，
 * 由调用方把解析到的小数位数作为参数传入，因此 1 位小数的补齐行为可以被直接断言，
 * 不再依赖真实入参能否构造出该位数。
 */
import { describe, expect, it } from 'vitest';

import {
  floatToFixed2,
  formatToFraction,
  padFractionToTwoDigits,
} from '../formatNumber';

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

  it('分值格式化的小数部分长度永远不是 1', /** 该不变量说明真实入参构造不出 1 位小数，补齐规则必须靠显式入参覆盖。 */ () => {
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

describe('padFractionToTwoDigits 补齐规则', /** 补齐规则是金额展示串的最后一道格式保障，每位小数都必须有确定结果。 */ () => {
  it('按传入的小数位数逐位补齐到两位', /** 位数与补齐动作错配会让金额少一位或多一位，展示值直接失真。 */ () => {
    // 0 位小数：toFixed 交出整数串，必须补足两位。
    expect(padFractionToTwoDigits('12', 0)).toBe('12.00');
    // 1 位小数：真实入参构造不出，但上游交出 1 位时只能补一个 0，不能补 '.00'。
    expect(padFractionToTwoDigits('12.3', 1)).toBe('12.30');
    // 2 位小数：已经是目标形态，必须原样返回，不能被二次改写。
    expect(padFractionToTwoDigits('12.34', 2)).toBe('12.34');
    // 负数与零同样按位数补齐，符号位不参与小数位判断。
    expect(padFractionToTwoDigits('-0', 0)).toBe('-0.00');
    expect(padFractionToTwoDigits('-0.5', 1)).toBe('-0.50');
  });

  it('位数无法识别时退回默认展示串', /** 指数写法等未知位数不能交出残缺文本，否则表格金额列会出现半截数字。 */ () => {
    expect(padFractionToTwoDigits('1.5e+21', 5)).toBe('0.00');
    expect(padFractionToTwoDigits('NaN', 0)).toBe('NaN.00');
  });

  it('补齐结果与 floatToFixed2 的真实输出逐值一致', /** 提取补齐动作不能改变任何真实取值的展示结果。 */ () => {
    const samples: (number | string | undefined)[] = [
      undefined,
      0,
      1,
      -1,
      100,
      12_345,
      1e21,
      1.5e23,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1234',
      'abc',
    ];

    for (const sample of samples) {
      if (sample === undefined) continue;
      const formatted = formatToFraction(sample);
      const decimalPart = formatted.split('.')[1];
      const decimalLength = decimalPart ? decimalPart.length : 0;
      expect(floatToFixed2(sample)).toBe(
        padFractionToTwoDigits(formatted, decimalLength),
      );
    }
  });
});

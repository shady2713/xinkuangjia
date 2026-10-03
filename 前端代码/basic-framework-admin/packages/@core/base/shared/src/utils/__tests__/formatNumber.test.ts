/** 金额与数量格式化工具的边界测试：分/元换算、环比、ERP 固定小数位与空值兜底。 */
import { describe, expect, it } from 'vitest';

import {
  calculateRelativeRate,
  convertToInteger,
  erpCalculatePercentage,
  erpCountInputFormatter,
  erpCountTableColumnFormatter,
  erpNumberFormatter,
  erpPriceInputFormatter,
  erpPriceMultiply,
  erpPriceTableColumnFormatter,
  fenToYuan,
  fenToYuanFormat,
  floatToFixed2,
  formatToFraction,
  formatToFractionDigit,
  yuanToFen,
} from '../formatNumber';

describe('formatToFractionDigit', /** 分转元的公共换算口径，供下面几个格式化函数复用。 */ () => {
  it('未传值时返回 0.00', /** 空单元格不能渲染成 NaN，缺失金额按零展示。 */ () => {
    expect(formatToFractionDigit(undefined)).toBe('0.00');
  });

  it('整数分按百分之一还原为元', /** 1234 分必须显示成 12.34 元而不是 1234。 */ () => {
    expect(formatToFractionDigit(1234)).toBe('12.34');
  });

  it('字符串入参先解析再换算', /** 表格 formatter 常见字符串来源，不能因类型不同算出别的结果。 */ () => {
    expect(formatToFractionDigit('1234')).toBe('12.34');
  });

  it('按传入位数补齐小数', /** digit 决定展示精度，位数不足时补零而不是截断。 */ () => {
    expect(formatToFractionDigit(1234, 3)).toBe('12.340');
  });
});

describe('formatToFraction', /** 固定两位的分转元入口。 */ () => {
  it('固定保留两位小数', /** 两位是本项目金额展示的默认精度。 */ () => {
    expect(formatToFraction(5)).toBe('0.05');
  });

  it('空值按 0.00 处理', /** 与 formatToFractionDigit 保持同一兜底口径。 */ () => {
    expect(formatToFraction(undefined)).toBe('0.00');
  });
});

describe('floatToFixed2', /** 补齐到 1.00 形态的展示格式化。 */ () => {
  it('两位小数原样返回', /** 已经是两位时不再追加字符。 */ () => {
    expect(floatToFixed2(1234)).toBe('12.34');
  });

  it('整元补两个零', /** 1200 分必须显示 12.00 而不是 12。 */ () => {
    expect(floatToFixed2(1200)).toBe('12.00');
  });

  it('一位小数补一个零', /** 1230 分显示 12.30。 */ () => {
    expect(floatToFixed2(1230)).toBe('12.30');
  });

  it('空值返回 0.00', /** 缺失值统一按零展示，避免出现 undefined 文本。 */ () => {
    expect(floatToFixed2(undefined)).toBe('0.00');
  });

  it('输入为 NaN 时走无小数分号分支', /** 表单里的脏数据会使转换结果不含小数点，当前实现会拼出 NaN.00。 */ () => {
    expect(floatToFixed2(Number.NaN)).toBe('NaN.00');
  });
});

describe('convertToInteger', /** 元转分的四舍五入换算。 */ () => {
  it('元乘以一百取整', /** 12.34 元应换算为 1234 分。 */ () => {
    expect(convertToInteger(12.34)).toBe(1234);
  });

  it('字符串元先解析再换算', /** 表单读入的字符串金额需要先转成数字。 */ () => {
    expect(convertToInteger('12.34')).toBe(1234);
  });

  it('空值按零分处理', /** 缺失金额不能变成 NaN 分。 */ () => {
    expect(convertToInteger(undefined)).toBe(0);
  });
});

describe('yuanToFen 与 fenToYuan', /** 金额单位互换的对外便捷入口。 */ () => {
  it('元转分', /** 供提交给后端使用。 */ () => {
    expect(yuanToFen('19.99')).toBe(1999);
  });

  it('分转元', /** 供展示给用户使用。 */ () => {
    expect(fenToYuan(1999)).toBe('19.99');
  });
});

describe('fenToYuanFormat', /** vxe-table 单元格格式化器，签名由表格库固定。 */ () => {
  it('带人民币符号输出元金额', /** 金额列必须带￥前缀以区分普通数字列。 */ () => {
    expect(fenToYuanFormat(undefined, undefined, 1234, undefined)).toBe(
      '￥12.34',
    );
  });

  it('空单元格显示 ￥0.00', /** 空值不能渲染成￥undefined。 */ () => {
    expect(fenToYuanFormat(undefined, undefined, undefined, undefined)).toBe(
      '￥0.00',
    );
  });
});

describe('calculateRelativeRate', /** 环比计算，除零时必须给出确定的数值而不是 Infinity。 */ () => {
  it('上涨时返回正百分比', /** 110 对比 100 即上涨 10%。 */ () => {
    expect(calculateRelativeRate(110, 100)).toBe(10);
  });

  it('参考值为零时返回零', /** 除零会产生 Infinity，列表里无法展示。 */ () => {
    expect(calculateRelativeRate(110, 0)).toBe(0);
  });

  it('参考值缺失时返回零', /** 参考列未采集时不能算出一个假环比。 */ () => {
    expect(calculateRelativeRate(110)).toBe(0);
  });

  it('当前值缺失时按零参与计算', /** 当前列未采集时结果等于 -100%，而不是抛错。 */ () => {
    expect(calculateRelativeRate(undefined, 100)).toBe(-100);
  });
});

describe('erpNumberFormatter', /** ERP 表格与输入框共用的定点格式化。 */ () => {
  it('按传入位数保留小数', /** 数量列三位、价格列两位由调用方决定。 */ () => {
    expect(erpNumberFormatter(1.2345, 3)).toBe('1.234');
  });

  it('字符串入参先解析', /** 输入框读出的字符串数量仍要按数值格式化。 */ () => {
    expect(erpNumberFormatter('2.5', 2)).toBe('2.50');
  });

  it('空值返回空串', /** 输入框为空时不显示 0，用户才能区分“没填”和“填了 0”。 */ () => {
    expect(erpNumberFormatter(undefined, 2)).toBe('');
  });

  it('非数字字符串返回空串', /** 输入了字母时不能把 NaN 写进输入框。 */ () => {
    expect(erpNumberFormatter('abc', 2)).toBe('');
  });
});

describe('数量与价格格式化入口', /** ERP 的四个入口分别固定数量三位、价格两位，避免表格与输入框口径漂移。 */ () => {
  it('数量格式化保留三位小数', /** 库存数量允许千分位以下三位。 */ () => {
    expect(erpCountInputFormatter(1.5)).toBe('1.500');
    expect(erpCountTableColumnFormatter(1.5)).toBe('1.500');
  });

  it('价格格式化保留两位小数', /** 价格按分结算，展示两位。 */ () => {
    expect(erpPriceInputFormatter(1.239)).toBe('1.24');
    expect(erpPriceTableColumnFormatter(1.239)).toBe('1.24');
  });
});

describe('erpPriceMultiply', /** 价格乘数量的金额计算。 */ () => {
  it('正常金额相乘后四舍五入两位', /** 12.5×2 精确等于 25，不应出现浮点尾差。 */ () => {
    expect(erpPriceMultiply(12.5, 2)).toBe(25);
  });

  it('结果按两位四舍五入', /** 0.1×3 的浮点误差必须被收敛成 0.3。 */ () => {
    expect(erpPriceMultiply(0.1, 3)).toBe(0.3);
  });

  it('历史表单传入空价格时拒绝计算', /** 旧版表单把空输入框当字符串提交，此时必须返回 undefined 让调用方中断。 */ () => {
    /** 空输入框在旧版表单里以空字符串提交，运行时值确实是字符串而非数字。 */
    const legacyEmptyPrice: number = JSON.parse('""');
    expect(erpPriceMultiply(legacyEmptyPrice, 2)).toBeUndefined();
  });
});

describe('erpCalculatePercentage', /** 占比计算，总数为零时必须给出确定的零。 */ () => {
  it('计算百分比并保留两位', /** 1/4 展示为 25.00。 */ () => {
    expect(erpCalculatePercentage(1, 4)).toBe('25.00');
  });

  it('总数为零时返回零', /** 除零会产生 NaN，进度条无法渲染。 */ () => {
    expect(erpCalculatePercentage(1, 0)).toBe(0);
  });
});

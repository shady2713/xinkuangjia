/** 颜色明暗判定的测试：确认深浅色判断与主题切换所需的相反结论。 */
import { describe, expect, it } from 'vitest';

import { isDarkColor, isLightColor } from '../color';

describe('isDarkColor', /** 依据感知亮度判断是否需要切换到浅色前景。 */ () => {
  it('黑色判定为深色', /** 纯黑背景必须使用浅色文字。 */ () => {
    expect(isDarkColor('#000000')).toBe(true);
  });

  it('白色判定为浅色', /** 纯白背景属于浅色，不能套用深色主题。 */ () => {
    expect(isDarkColor('#ffffff')).toBe(false);
  });

  it('深蓝属于深色', /** 中等亮度的深色同样需要浅色前景。 */ () => {
    expect(isDarkColor('rgb(0, 0, 128)')).toBe(true);
  });
});

describe('isLightColor', /** 与 isDarkColor 结论互补，供调用方直接按"浅色"提问。 */ () => {
  it('白色判定为浅色', /** 纯白背景满足浅色判定。 */ () => {
    expect(isLightColor('#ffffff')).toBe(true);
  });

  it('黑色判定为深色', /** 纯黑背景不满足浅色判定。 */ () => {
    expect(isLightColor('#000000')).toBe(false);
  });

  it('同一颜色在两个判定下结论相反', /** 两个函数互为补集，调用方不能同时命中。 */ () => {
    for (const color of ['#000000', '#ffffff', 'rgb(0, 0, 128)']) {
      expect(isDarkColor(color)).toBe(!isLightColor(color));
    }
  });
});

/** 中国大陆手机号校验的测试：覆盖空值、带区号前缀与非法号段。 */
import { describe, expect, it } from 'vitest';

import { isMobile } from '../validator';

describe('isMobile', /** 只接受 11 位、以 1 开头且第二位为 3-9 的号码，允许可选区号前缀。 */ () => {
  it('标准 11 位手机号通过校验', /** 138 开头的号段是合法大陆手机号。 */ () => {
    expect(isMobile('13800138000')).toBe(true);
  });

  it('带 +86 前缀的号码同样通过', /** 海外登记的号码会带国际区号。 */ () => {
    expect(isMobile('+8613800138000')).toBe(true);
  });

  it('带 86 前缀的号码同样通过', /** 页面表单里常见无加号写法。 */ () => {
    expect(isMobile('8613800138000')).toBe(true);
  });

  it('空值判定为非手机号', /** 必填校验在值为空时直接返回 false，不进入正则。 */ () => {
    expect(isMobile('')).toBe(false);
    expect(isMobile(null)).toBe(false);
    expect(isMobile()).toBe(false);
  });

  it('第二位不在 3-9 的号段被拒绝', /** 10 开头不是移动号段。 */ () => {
    expect(isMobile('10800138000')).toBe(false);
  });

  it('位数不足被拒绝', /** 少于 11 位时正则匹配不到。 */ () => {
    expect(isMobile('1380013800')).toBe(false);
  });

  it('正则未加首尾锚点，超长或夹杂文本的字符串仍会命中', /** 当前实现只要包含一段合法号码即返回 true，输入层需自行限制长度与字符。 */ () => {
    expect(isMobile('138001380000')).toBe(true);
    expect(isMobile('tel:13800138000')).toBe(true);
  });
});

/**
 * 手机号校验函数：用 regex 的 MOBILE_REGEX 判断入参是否为中国大陆号码，
 * 允许可选的 0、86、+86 前缀，空值与缺省一律返回 false。
 *
 * 正则未加首尾锚点，含号码片段的文本也会命中，输入长度与字符需由调用方限制；
 * 业务表单里的手机号规则另见 apps/web-ele/src/adapter/field-rules.ts。
 */
import { MOBILE_REGEX } from './regex';

/**
 * 验证是否为手机号码（中国）
 *
 * @param value 值
 * @returns 是否为手机号码（中国）
 */
function isMobile(value?: null | string): boolean {
  if (!value) {
    return false;
  }
  return MOBILE_REGEX.test(value);
}

export { isMobile };

/** 验证前端密码复杂度规则与后端等保二级策略一致。 */
import { describe, expect, it, vi } from 'vitest';

import { isPasswordValue } from './field-rules';

/**
 * 模拟 common-ui 的 z，避免加载完整表单依赖。
 *
 * @returns 仅包含 z 的模块
 */
function mockCommonUi() {
  return { z: {} };
}

vi.mock('@vben/common-ui', mockCommonUi);

/**
 * 验证合规密码通过校验。
 *
 * @param value 待校验密码
 */
function acceptsValidPassword(value: string) {
  expect(isPasswordValue(value)).toBe(true);
}

/**
 * 验证不合规密码被拒绝。
 *
 * @param value 待校验密码
 */
function rejectsInvalidPassword(value: string) {
  expect(isPasswordValue(value)).toBe(false);
}

/** 密码复杂度规则测试套件。 */
function passwordPolicySuite() {
  it.each([
    'Abcdef12', // 小写 + 大写 + 数字
    'Abcdef1#', // 小写 + 大写 + 数字 + 特殊
    'aB3$efgh', // 4 类字符
    'Abcdefgh1', // 大写 + 小写 + 数字
  ])('接受满足 8-32 位且至少 3 类字符的密码: %s', acceptsValidPassword);

  it.each([
    ['Ab1#efg', '长度不足 8'],
    ['Abcdef12#'.repeat(4), '长度超过 32'],
    ['abcdefgh', '只有小写字母'],
    ['ABCDEFGH', '只有大写字母'],
    ['12345678', '只有数字'],
    ['Abcdefgh', '只有大小写两类'],
    ['Abcdef 1', '包含空格'],
    ['Abcdef1中', '包含非 ASCII 字符'],
    ['', '空密码'],
  ])('拒绝不符合规则的密码: %s（%s）', rejectsInvalidPassword);
}

describe('密码复杂度规则', passwordPolicySuite);

import { describe, expect, it } from 'vitest';

import {
  deleteConfirmMessage,
  FIELD_LIMITS,
  maxLenRule,
  mobileRule,
  passwordComplexityRule,
  REGEX_PATTERNS,
  requiredRule,
} from './validation';

describe('validation constants and rule helpers', () => {
  it('matches database column limits and builds consistent Chinese messages', () => {
    expect(FIELD_LIMITS.USERNAME).toBe(30);
    expect(FIELD_LIMITS.REMARK).toBe(500);
    expect(FIELD_LIMITS.DICT_NAME).toBe(100);
    expect(requiredRule('角色名称').message).toBe('请输入角色名称');
    expect(requiredRule('所属平台', 'change').message).toBe('请选择所属平台');
    expect(maxLenRule('备注', 500).message).toBe('备注长度不能超过 500 个字符');
    expect(deleteConfirmMessage('测试角色')).toBe(
      '是否确认删除「测试角色」？删除后无法恢复。',
    );
  });

  it('validates mobile and strong password patterns', () => {
    expect(REGEX_PATTERNS.MOBILE.test('13800138000')).toBe(true);
    expect(REGEX_PATTERNS.MOBILE.test('12345')).toBe(false);
    expect(REGEX_PATTERNS.STRONG_PASSWORD.test('Admin2026')).toBe(true);
    expect(REGEX_PATTERNS.STRONG_PASSWORD.test('weakpass')).toBe(false);
    expect(mobileRule().pattern).toBe(REGEX_PATTERNS.MOBILE);
    expect(passwordComplexityRule().pattern).toBe(REGEX_PATTERNS.STRONG_PASSWORD);
  });
});

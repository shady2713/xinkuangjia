import { describe, expect, it } from 'vitest';

import {
  deleteConfirmMessage,
  emailRule,
  FIELD_LIMITS,
  isStrongPassword,
  maxLenRule,
  mobileRule,
  passwordComplexityRule,
  REGEX_PATTERNS,
  requiredNumberRule,
  requiredRule,
  smsCodeRule,
} from './validation';

describe('validation constants and rule helpers', () => {
  it('matches database column limits and builds consistent Chinese messages', () => {
    expect(FIELD_LIMITS.USERNAME).toBe(30);
    expect(FIELD_LIMITS.REMARK).toBe(500);
    expect(FIELD_LIMITS.DICT_NAME).toBe(100);
    expect(FIELD_LIMITS.OAUTH_SECRET).toBe(72);
    expect(FIELD_LIMITS.FILE_TYPE).toBe(128);
    expect(requiredRule('角色名称')).toMatchObject({
      required: true,
      whitespace: true,
      message: '请输入角色名称',
    });
    expect(requiredRule('所属平台', 'change').message).toBe('请选择所属平台');
    expect(requiredNumberRule('显示排序')).toMatchObject({
      required: true,
      type: 'number',
      message: '请输入显示排序',
    });
    expect(maxLenRule('备注', 500).message).toBe('备注长度不能超过 500 个字符');
    expect(deleteConfirmMessage('测试角色')).toBe(
      '是否确认删除「测试角色」？删除后无法恢复。',
    );
  });

  it('validates mobile, sms code, email, username and level-2 strong password rules', () => {
    expect(REGEX_PATTERNS.MOBILE.test('13800138000')).toBe(true);
    expect(REGEX_PATTERNS.MOBILE.test('12345')).toBe(false);
    expect(REGEX_PATTERNS.SMS_CODE.test('123456')).toBe(true);
    expect(REGEX_PATTERNS.SMS_CODE.test('12345a')).toBe(false);
    expect(REGEX_PATTERNS.USERNAME.test('user_a')).toBe(true);
    expect(REGEX_PATTERNS.EMAIL.test('admin@example.com')).toBe(true);
    expect(REGEX_PATTERNS.EMAIL.test('bad-email')).toBe(false);
    expect(mobileRule().pattern).toBe(REGEX_PATTERNS.MOBILE);
    expect(smsCodeRule().pattern).toBe(REGEX_PATTERNS.SMS_CODE);
    expect(emailRule().pattern).toBe(REGEX_PATTERNS.EMAIL);

    // 与后端 ValidationUtils.isPassword 1:1 对齐：8-32 位可见 ASCII 且 4 类中至少 3 类
    expect(isStrongPassword('Admin2026')).toBe(true);
    expect(isStrongPassword('abcdef1!')).toBe(true);
    expect(isStrongPassword('ABCDEF1!')).toBe(true);
    expect(isStrongPassword('Abcdefg!')).toBe(true);
    expect(isStrongPassword('weakpass')).toBe(false);
    expect(isStrongPassword('Abcdef1')).toBe(false);
    expect(isStrongPassword('Abcdef 1')).toBe(false);
    expect(isStrongPassword('Abcdef1中')).toBe(false);

    const rule = passwordComplexityRule();
    let captured: Error | undefined;
    rule.validator?.({} as never, 'weakpass', (err?: string | Error) => {
      captured = err instanceof Error ? err : undefined;
    }, {} as never, {} as never);
    expect(captured?.message).toContain('至少包含大写字母、小写字母、数字、特殊字符中的 3 类');
  });
});

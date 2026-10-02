import { describe, expect, it, vi } from 'vitest';

function createRuleChain() {
  return {
    default: vi.fn(() => createRuleChain()),
    email: vi.fn(() => createRuleChain()),
    max: vi.fn(() => createRuleChain()),
    min: vi.fn(() => createRuleChain()),
    optional: vi.fn(() => createRuleChain()),
    or: vi.fn(() => createRuleChain()),
    regex: vi.fn(() => createRuleChain()),
    refine: vi.fn(() => createRuleChain()),
  };
}

vi.mock('@vben/constants', () => ({
  CommonStatusEnum: {
    ENABLE: 0,
  },
  DICT_TYPE: {
    COMMON_STATUS: 'common_status',
    SYSTEM_USER_SEX: 'system_user_sex',
  },
}));

vi.mock('@vben/hooks', () => ({
  getDictOptions: vi.fn(() => []),
}));

vi.mock('@vben/utils', () => ({
  handleTree: (data: unknown) => data,
}));

vi.mock('#/api/system/dept', () => ({
  getDeptList: vi.fn(async () => []),
}));

vi.mock('#/api/system/post', () => ({
  getSimplePostList: vi.fn(async () => []),
}));

vi.mock('#/api/system/role', () => ({
  getSimpleRoleList: vi.fn(async () => []),
}));

vi.mock('#/utils', () => ({
  getRangePickerDefaultProps: () => ({}),
}));

vi.mock('#/adapter/form', () => ({
  z: {
    boolean: vi.fn(() => createRuleChain()),
    literal: vi.fn(() => createRuleChain()),
    number: vi.fn(() => createRuleChain()),
    string: vi.fn(() => createRuleChain()),
  },
}));

import { useFormSchema } from './data';

describe('system user form schema', () => {
  it('新增用户密码字段使用与个人中心一致的密码组件和规则', () => {
    const passwordField = useFormSchema().find((item) => item.fieldName === 'password');

    // 锁定新增用户密码项，避免后续回退成仅必填但不校验复杂度的表单配置。
    expect(passwordField).toMatchObject({
      component: 'VbenInputPassword',
      rules: 'passwordRequired',
    });
    expect(passwordField?.componentProps).toMatchObject({
      passwordStrength: true,
    });
  });
});

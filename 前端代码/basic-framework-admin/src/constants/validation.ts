import type { FormItemRule } from 'element-plus';

/**
 * 前后端 1:1 对齐的字段长度常量（与数据库 basic_framework.sql 及后端 ReqVO @Size 保持严格一致）。
 */
export const FIELD_LIMITS = {
  // 通用与查询
  SEARCH_KEYWORD: 100,
  REMARK: 500,
  URL: 512,
  SMS_CODE: 6,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 32,

  // 用户管理（system_users）
  USERNAME_MIN: 4,
  USERNAME: 30,
  NICKNAME: 30,
  EMAIL: 50,
  MOBILE: 11,
  AVATAR: 512,

  // 部门管理（system_dept）
  DEPT_NAME: 30,

  // 角色管理（system_role）
  ROLE_NAME: 30,
  ROLE_CODE: 100,

  // 菜单管理（system_menu）
  MENU_NAME: 50,
  MENU_PERMISSION: 100,
  MENU_PATH: 200,
  MENU_ICON: 100,
  MENU_COMPONENT: 255,
  MENU_COMPONENT_NAME: 255,

  // 字典管理（system_dict_type / system_dict_data）
  DICT_NAME: 100,
  DICT_TYPE: 100,
  DICT_LABEL: 100,
  DICT_VALUE: 100,
  DICT_CSS_CLASS: 100,

  // OAuth2 应用（system_oauth2_client）
  OAUTH_CLIENT_ID: 255,
  OAUTH_SECRET: 255,
  OAUTH_NAME: 255,
  OAUTH_DESCRIPTION: 255,

  // 文件管理（infra_file）
  FILE_PATH: 512,
} as const;

export const REGEX_PATTERNS = {
  USERNAME: /^[a-zA-Z0-9_]+$/,
  MOBILE: /^1\d{10}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  STRONG_PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,32}$/,
} as const;

export function requiredRule(label: string, trigger: 'blur' | 'change' = 'blur'): FormItemRule {
  return {
    required: true,
    message: trigger === 'change' ? `请选择${label}` : `请输入${label}`,
    trigger,
  };
}

export function maxLenRule(label: string, max: number): FormItemRule {
  return {
    max,
    message: `${label}长度不能超过 ${max} 个字符`,
    trigger: 'blur',
  };
}

export function rangeLenRule(label: string, min: number, max: number): FormItemRule {
  return {
    min,
    max,
    message: `${label}长度须为 ${min}~${max} 个字符`,
    trigger: 'blur',
  };
}

export function mobileRule(): FormItemRule {
  return {
    pattern: REGEX_PATTERNS.MOBILE,
    message: '请输入正确的 11 位手机号',
    trigger: 'blur',
  };
}

export function emailRule(): FormItemRule {
  return {
    type: 'email',
    message: '请输入正确的邮箱格式',
    trigger: 'blur',
  };
}

export function passwordComplexityRule(): FormItemRule {
  return {
    pattern: REGEX_PATTERNS.STRONG_PASSWORD,
    message: '密码须为 8~32 位，且同时包含大小写字母和数字',
    trigger: 'blur',
  };
}

export function deleteConfirmMessage(targetName?: string | number | null): string {
  const label = targetName ? `「${targetName}」` : '所选记录';
  return `是否确认删除${label}？删除后无法恢复。`;
}

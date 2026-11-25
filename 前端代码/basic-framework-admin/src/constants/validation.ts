import type { FormItemRule } from 'element-plus';

/**
 * 前后端 1:1 对齐的字段长度与数值边界常量（与数据库 basic_framework.sql 及后端 ReqVO 校验保持严格一致）。
 */
export const FIELD_LIMITS = {
  // 通用与查询
  SEARCH_KEYWORD: 100,
  REMARK: 500,
  SMS_CODE: 6,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 32,
  SORT_MIN: 0,
  SORT_MAX: 99_999,
  NUMERIC_ID: 20,

  // 用户管理（system_users）
  USERNAME_MIN: 4,
  USERNAME: 30,
  NICKNAME: 30,
  EMAIL: 50,
  MOBILE: 11,

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

  // OAuth2 应用（system_oauth2_client）
  OAUTH_CLIENT_ID: 255,
  OAUTH_SECRET: 72,
  OAUTH_NAME: 255,
  OAUTH_DESCRIPTION: 255,
  OAUTH_SCOPES: 255,
  OAUTH_TOKEN_VALIDITY_MIN: 60,
  OAUTH_TOKEN_VALIDITY_MAX: 31_536_000,

  // 日志与文件（system_login_log / system_operate_log / infra_file）
  USER_IP: 50,
  LOG_MODULE: 50,
  FILE_PATH: 512,
  FILE_TYPE: 128,
} as const;

export const REGEX_PATTERNS = {
  USERNAME: /^[A-Za-z0-9_]+$/,
  MOBILE: /^1\d{10}$/,
  EMAIL: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,
  SMS_CODE: /^\d{6}$/,
  NUMERIC_ID: /^\d+$/,
} as const;

export const PASSWORD_PLACEHOLDER = '请输入 8~32 位密码（大小写/数字/特殊字符至少 3 类）';

const PASSWORD_PRINTABLE_MIN = 0x21;
const PASSWORD_PRINTABLE_MAX = 0x7e;
const PASSWORD_MIN_CLASSES = 3;

/**
 * 与后端 ValidationUtils.isPassword 严格等价的等保二级复杂度校验：
 * 8~32 位可见 ASCII（排除空格、控制字符及非 ASCII 字符），
 * 且大小写字母、数字、特殊字符 4 类中至少包含 3 类。
 */
export function isStrongPassword(password: string): boolean {
  if (!password) return false;
  if (password.length < FIELD_LIMITS.PASSWORD_MIN || password.length > FIELD_LIMITS.PASSWORD_MAX) {
    return false;
  }
  let hasLower = false;
  let hasUpper = false;
  let hasDigit = false;
  let hasSpecial = false;
  for (let i = 0; i < password.length; i += 1) {
    const code = password.charCodeAt(i);
    if (code < PASSWORD_PRINTABLE_MIN || code > PASSWORD_PRINTABLE_MAX) {
      return false;
    }
    if (code >= 0x61 && code <= 0x7a) {
      hasLower = true;
    } else if (code >= 0x41 && code <= 0x5a) {
      hasUpper = true;
    } else if (code >= 0x30 && code <= 0x39) {
      hasDigit = true;
    } else {
      hasSpecial = true;
    }
  }
  const classes = Number(hasLower) + Number(hasUpper) + Number(hasDigit) + Number(hasSpecial);
  return classes >= PASSWORD_MIN_CLASSES;
}

export function requiredRule(label: string, trigger: 'blur' | 'change' = 'blur'): FormItemRule {
  return {
    required: true,
    ...(trigger === 'blur' ? { whitespace: true } : {}),
    message: trigger === 'change' ? `请选择${label}` : `请输入${label}`,
    trigger,
  };
}

export function requiredNumberRule(label: string): FormItemRule {
  return {
    required: true,
    type: 'number',
    message: `请输入${label}`,
    trigger: 'change',
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

export function smsCodeRule(): FormItemRule {
  return {
    pattern: REGEX_PATTERNS.SMS_CODE,
    message: '请输入 6 位数字验证码',
    trigger: 'blur',
  };
}

export function emailRule(): FormItemRule {
  return {
    pattern: REGEX_PATTERNS.EMAIL,
    message: '请输入正确的邮箱格式',
    trigger: 'blur',
  };
}

export function passwordComplexityRule(): FormItemRule {
  return {
    validator: (_rule, value, callback) => {
      if (!value) {
        callback();
        return;
      }
      if (!isStrongPassword(String(value))) {
        callback(
          new Error(
            `密码必须为 ${FIELD_LIMITS.PASSWORD_MIN}~${FIELD_LIMITS.PASSWORD_MAX} 位可见字符，且至少包含大写字母、小写字母、数字、特殊字符中的 3 类`,
          ),
        );
        return;
      }
      callback();
    },
    trigger: 'blur',
  };
}

export function deleteConfirmMessage(targetName?: string | number | null): string {
  const label = targetName ? `「${targetName}」` : '所选记录';
  return `是否确认删除${label}？删除后无法恢复。`;
}

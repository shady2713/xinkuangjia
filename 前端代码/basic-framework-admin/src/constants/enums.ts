/**
 * 与后端保持严格一致的业务枚举与字典类型常量。
 */
export const CommonStatusEnum = {
  ENABLE: 0,
  DISABLE: 1,
} as const;

export const UserTypeEnum = {
  MEMBER: 1,
  ADMIN: 2,
} as const;

export const SystemMenuTypeEnum = {
  DIR: 1,
  MENU: 2,
  BUTTON: 3,
} as const;

export const SystemRoleTypeEnum = {
  SYSTEM: 1,
  CUSTOM: 2,
} as const;

export const SystemDataScopeEnum = {
  ALL: 1,
  DEPT_CUSTOM: 2,
  DEPT_ONLY: 3,
  DEPT_AND_CHILD: 4,
  DEPT_SELF: 5,
} as const;

export const SmsSceneEnum = {
  ADMIN_MEMBER_LOGIN: 21,
  ADMIN_MEMBER_RESET_PASSWORD: 23,
} as const;

export const DICT_TYPE = {
  COMMON_STATUS: 'common_status',
  USER_TYPE: 'user_type',
  SYSTEM_USER_SEX: 'system_user_sex',
  SYSTEM_MENU_TYPE: 'system_menu_type',
  SYSTEM_ROLE_TYPE: 'system_role_type',
  SYSTEM_DATA_SCOPE: 'system_data_scope',
  SYSTEM_LOGIN_TYPE: 'system_login_type',
  SYSTEM_LOGIN_RESULT: 'system_login_result',
  SYSTEM_OAUTH2_GRANT_TYPE: 'system_oauth2_grant_type',
  INFRA_BOOLEAN_STRING: 'infra_boolean_string',
} as const;

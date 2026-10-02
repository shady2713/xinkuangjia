/** ========== COMMON - 通用模块 ========== */
const COMMON_DICT = {
  USER_TYPE: 'user_type',
  COMMON_STATUS: 'common_status',
  TERMINAL: 'terminal', // 终端
  DATE_INTERVAL: 'date_interval', // 数据间隔
} as const;

/** ========== SYSTEM - 系统模块 ========== */
const SYSTEM_DICT = {
  SYSTEM_USER_SEX: 'system_user_sex',
  SYSTEM_MENU_TYPE: 'system_menu_type',
  SYSTEM_ROLE_TYPE: 'system_role_type',
  SYSTEM_DATA_SCOPE: 'system_data_scope',
  SYSTEM_LOGIN_TYPE: 'system_login_type',
  SYSTEM_LOGIN_RESULT: 'system_login_result',
  SYSTEM_SMS_CHANNEL_CODE: 'system_sms_channel_code',
  SYSTEM_SMS_TEMPLATE_TYPE: 'system_sms_template_type',
  SYSTEM_SMS_SEND_STATUS: 'system_sms_send_status',
  SYSTEM_SMS_RECEIVE_STATUS: 'system_sms_receive_status',
  SYSTEM_OAUTH2_GRANT_TYPE: 'system_oauth2_grant_type',
} as const;

/** ========== INFRA - 基础设施模块 ========== */
const INFRA_DICT = {
  INFRA_BOOLEAN_STRING: 'infra_boolean_string',
  INFRA_JOB_STATUS: 'infra_job_status',
  INFRA_JOB_LOG_STATUS: 'infra_job_log_status',
  INFRA_CONFIG_TYPE: 'infra_config_type',
  INFRA_FILE_STORAGE: 'infra_file_storage',
  INFRA_OPERATE_TYPE: 'infra_operate_type',
} as const;

/** 字典类型枚举 - 统一导出 */
const DICT_TYPE = {
  ...INFRA_DICT,
  ...SYSTEM_DICT,
  ...COMMON_DICT,
} as const;

export { DICT_TYPE };

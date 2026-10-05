/**
 * 表单字段的取值校验规则与 Zod 校验器工厂。
 * 供 CRUD 表单、字段适配器与列表查询条件复用，保证前后端规则文字一致。
 */
import { z } from '@vben/common-ui';

const USERNAME_REGEX = /^[A-Z0-9]{4,30}$/i;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{6,16}$/;
const MOBILE_REGEX = /^1\d{10}$/;
const EMAIL_REGEX = /^[\w.%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const ID_CARD_REGEX =
  /^[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9X]$/i;
const REAL_NAME_REGEX = /^[A-Z\u4E00-\u9FA5·]{2,30}$/i;
const BANK_CARD_NO_REGEX = /^\d{12,19}$/;
const PERCENT_REGEX = /^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/;
const ID_CARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CARD_CHECK_CODES = [
  '1',
  '0',
  'X',
  '9',
  '8',
  '7',
  '6',
  '5',
  '4',
  '3',
  '2',
];

/** 日期字段的默认展示与提交格式，精确到日。 */
export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
/** 日期时间字段的默认展示与提交格式，精确到秒。 */
export const DEFAULT_DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
 * 把任意取值转换为去首尾空格的字符串。
 * @param value 待转换的取值，null 与 undefined 按空串处理
 * @returns 去除首尾空格后的字符串
 */
function trimValue(value: unknown) {
  return String(value ?? '').trim();
}

/**
 * 判断取值去除首尾空格后是否为空串。
 * @param value 待判断的取值
 * @returns 去空格后长度为 0 时为 true
 */
function isBlank(value: unknown) {
  return trimValue(value).length === 0;
}

/**
 * 判断取值是否已填写；字符串按去空格后是否为空判断，其他类型一律视为已填写。
 *
 * 本函数与同模块的其他取值判定一样接收显式入参：Zod 精化回调在联合类型拒绝
 * `undefined` / `null` 后不会再执行，因此空值分支只能由调用方直接传入空值来验证。
 * @param value 待判断的取值
 * @returns 取值已填写时为 true；undefined、null 以及去空格后为空串的字符串为 false
 */
export function isPresent(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return !isBlank(value);
  }
  return true;
}

/**
 * 判断用户名是否为 4-30 位字母或数字。
 * @param value 待校验的用户名
 * @returns 匹配用户名规则时为 true
 */
export function isUsernameValue(value: string) {
  return USERNAME_REGEX.test(value);
}

/**
 * 判断密码是否为 6-16 位且同时包含大写字母、小写字母和数字。
 * @param value 待校验的密码
 * @returns 匹配密码强度规则时为 true
 */
export function isPasswordValue(value: string) {
  return PASSWORD_REGEX.test(value);
}

/**
 * 判断手机号是否为 1 开头的 11 位数字。
 * @param value 待校验的手机号
 * @returns 匹配手机号规则时为 true
 */
export function isMobileValue(value: string) {
  return MOBILE_REGEX.test(value);
}

/**
 * 判断邮箱地址是否符合常见的“名称@域名.后缀”形式。
 * @param value 待校验的邮箱地址
 * @returns 匹配邮箱规则时为 true
 */
export function isEmailValue(value: string) {
  return EMAIL_REGEX.test(value);
}

/**
 * 判断二代身份证号是否合法：先匹配 18 位格式，再校验出生日期真实存在、不早于 1900 年、不晚于当天，最后比对加权校验位。
 * @param value 待校验的身份证号，允许首尾空格与小写 x
 * @returns 格式、日期与校验位全部通过时为 true
 */
export function isIdCardValue(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!ID_CARD_REGEX.test(normalized)) {
    return false;
  }
  const birthday = normalized.slice(6, 14);
  const year = Number(birthday.slice(0, 4));
  const month = Number(birthday.slice(4, 6));
  const day = Number(birthday.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    year < 1900 ||
    date.getTime() > Date.now()
  ) {
    return false;
  }
  const sum = ID_CARD_WEIGHTS.reduce((total, weight, index) => {
    return total + Number(normalized[index]) * weight;
  }, 0);
  return ID_CARD_CHECK_CODES[sum % 11] === normalized[17];
}

/**
 * 判断姓名是否为 2-30 位中文、英文字母或间隔号。
 * @param value 待校验的姓名
 * @returns 匹配姓名规则时为 true
 */
export function isRealNameValue(value: string) {
  return REAL_NAME_REGEX.test(value);
}

/**
 * 判断银行卡号是否为 12-19 位数字并通过 Luhn 校验。
 * @param value 待校验的银行卡号
 * @returns 位数与校验和都正确时为 true
 */
export function isBankCardNoValue(value: string) {
  if (!BANK_CARD_NO_REGEX.test(value)) {
    return false;
  }
  let sum = 0;
  let shouldDouble = false;
  for (let i = value.length - 1; i >= 0; i--) {
    let digit = Number(value[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * 判断取值是否为合法百分比。
 * @param value 待判断的取值，允许数字或数字字符串。
 * @returns 落在 0 到 100 且最多两位小数的范围内时为 true。
 */
export function isPercentValue(value: number | string) {
  return PERCENT_REGEX.test(String(value));
}

/**
 * 判断数量是否为非负整数。
 * @param value 待校验的数量
 * @returns 取值是大于等于 0 的整数时为 true
 */
export function isQuantityValue(value: number) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * 构建必填用户名校验器。
 * @param label 提示语中使用的字段名
 * @returns 去空格后必填且符合用户名规则的 Zod 字符串校验器
 */
export function buildRequiredUsernameSchema(label = '用户名') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isUsernameValue, {
      message: `${label}必须为 4-30 位字母或数字`,
    });
}

/**
 * 构建必填密码校验器。
 * @param label 提示语中使用的字段名
 * @returns 去空格后必填且符合密码强度规则的 Zod 字符串校验器
 */
export function buildRequiredPasswordSchema(label = '密码') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isPasswordValue, {
      message: `${label}必须为 6-16 位，且同时包含大写字母、小写字母和数字`,
    });
}

/**
 * 构建登录页密码校验器：只要求去空格后非空，不校验长度与字符集。
 * @param label 提示语中使用的字段名
 * @returns 仅校验必填的 Zod 字符串校验器
 */
export function buildLoginPasswordSchema(label = '密码') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` });
}

/**
 * 构建可选手机号校验器：未填写或只填空白时跳过格式校验。
 * @param label 提示语中使用的字段名
 * @returns 允许为空、填写时必须匹配手机号规则的 Zod 校验器
 */
export function buildOptionalMobileSchema(label = '手机号') {
  return z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => value === undefined || isBlank(value) || isMobileValue(value),
      {
        message: `${label}格式不正确`,
      },
    );
}

/**
 * 构建必填手机号校验器。
 * @param label 提示语中使用的字段名
 * @returns 去空格后必填且符合手机号规则的 Zod 字符串校验器
 */
export function buildRequiredMobileSchema(label = '手机号') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isMobileValue, {
      message: `${label}格式不正确`,
    });
}

/**
 * 构建可选邮箱校验器：未填写或只填空白时跳过格式校验。
 * @param label 提示语中使用的字段名
 * @returns 允许为空、填写时必须匹配邮箱规则的 Zod 校验器
 */
export function buildOptionalEmailSchema(label = '邮箱') {
  return z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => value === undefined || isBlank(value) || isEmailValue(value),
      {
        message: `${label}格式不正确`,
      },
    );
}

/**
 * 构建必填邮箱校验器。
 * @param label 提示语中使用的字段名
 * @returns 去空格后必填且符合邮箱规则的 Zod 字符串校验器
 */
export function buildRequiredEmailSchema(label = '邮箱') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isEmailValue, {
      message: `${label}格式不正确`,
    });
}

/**
 * 构建可选身份证号校验器：未填写或只填空白时跳过格式与校验位校验。
 * @param label 提示语中使用的字段名
 * @returns 允许为空、填写时必须通过身份证校验的 Zod 校验器
 */
export function buildOptionalIdCardSchema(label = '身份证号') {
  return z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => value === undefined || isBlank(value) || isIdCardValue(value),
      {
        message: `${label}格式不正确`,
      },
    );
}

/**
 * 构建必填身份证号校验器。
 * @param label 提示语中使用的字段名
 * @returns 去空格后必填且通过身份证校验的 Zod 字符串校验器
 */
export function buildRequiredIdCardSchema(label = '身份证号') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isIdCardValue, {
      message: `${label}格式不正确`,
    });
}

/**
 * 构建可选姓名校验器：未填写或只填空白时跳过格式校验。
 * @param label 提示语中使用的字段名
 * @returns 允许为空、填写时必须匹配姓名规则的 Zod 校验器
 */
export function buildOptionalRealNameSchema(label = '姓名') {
  return z
    .string()
    .trim()
    .optional()
    .refine(
      (value) =>
        value === undefined || isBlank(value) || isRealNameValue(value),
      {
        message: `${label}必须为 2-30 位中文、英文或中点`,
      },
    );
}

/**
 * 构建必填姓名校验器。
 * @param label 提示语中使用的字段名
 * @returns 去空格后必填且匹配姓名规则的 Zod 字符串校验器
 */
export function buildRequiredRealNameSchema(label = '姓名') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isRealNameValue, {
      message: `${label}必须为 2-30 位中文、英文或中点`,
    });
}

/**
 * 构建可选银行卡号校验器：未填写或只填空白时跳过位数与校验和校验。
 * @param label 提示语中使用的字段名
 * @returns 允许为空、填写时必须通过 Luhn 校验的 Zod 校验器
 */
export function buildOptionalBankCardSchema(label = '银行卡号') {
  return z
    .string()
    .trim()
    .optional()
    .refine(
      (value) =>
        value === undefined || isBlank(value) || isBankCardNoValue(value),
      {
        message: `${label}格式不正确`,
      },
    );
}

/**
 * 构建必填银行卡号校验器。
 * @param label 提示语中使用的字段名
 * @returns 去空格后必填且通过 Luhn 校验的 Zod 字符串校验器
 */
export function buildRequiredBankCardSchema(label = '银行卡号') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isBankCardNoValue, {
      message: `${label}格式不正确`,
    });
}

/**
 * 构建可选百分比校验器：接受字符串或数字，未填写时跳过范围校验。
 * @param label 提示语中使用的字段名
 * @returns 允许为空、填写时必须在 0-100 且最多两位小数的 Zod 校验器
 */
export function buildOptionalPercentSchema(label = '百分比') {
  return z
    .union([z.string(), z.number()])
    .optional()
    .refine(
      (value) => {
        return (
          value === undefined ||
          value === null ||
          isBlank(value) ||
          isPercentValue(value)
        );
      },
      {
        message: `${label}必须在 0-100 之间，最多保留两位小数`,
      },
    );
}

/**
 * 构建必填百分比校验器：接受字符串或数字，非空且必须在 0-100 之间、最多两位小数。
 * @param label 提示语中使用的字段名
 * @returns 校验取值范围与必填的 Zod 校验器
 */
export function buildRequiredPercentSchema(label = '百分比') {
  return z.union([z.string(), z.number()]).refine(
    (value) => {
      return isPresent(value) && isPercentValue(value);
    },
    {
      message: `${label}必须在 0-100 之间，最多保留两位小数`,
    },
  );
}

/**
 * 构建必填数量校验器。
 * @param label 提示语中使用的字段名
 * @returns 必须为非负整数的 Zod 数字校验器
 */
export function buildRequiredQuantitySchema(label = '数量') {
  return z
    .number({ required_error: `请输入${label}` })
    .int(`${label}必须为非负整数`)
    .min(0, `${label}必须为非负整数`);
}

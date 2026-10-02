import { z } from '@vben/common-ui';

const USERNAME_REGEX = /^[A-Za-z0-9]{4,30}$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d]{6,16}$/;
const MOBILE_REGEX = /^1\d{10}$/;
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const ID_CARD_REGEX =
  /^[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]$/;
const REAL_NAME_REGEX = /^[A-Za-z\u4e00-\u9fa5·]{2,30}$/;
const BANK_CARD_NO_REGEX = /^\d{12,19}$/;
const PERCENT_REGEX = /^(100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/;
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

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';
export const DEFAULT_DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

function trimValue(value: unknown) {
  return String(value ?? '').trim();
}

function isBlank(value: unknown) {
  return trimValue(value).length === 0;
}

function isPresent(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string') {
    return !isBlank(value);
  }
  return true;
}

export function isUsernameValue(value: string) {
  return USERNAME_REGEX.test(value);
}

export function isPasswordValue(value: string) {
  return PASSWORD_REGEX.test(value);
}

export function isMobileValue(value: string) {
  return MOBILE_REGEX.test(value);
}

export function isEmailValue(value: string) {
  return EMAIL_REGEX.test(value);
}

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

export function isRealNameValue(value: string) {
  return REAL_NAME_REGEX.test(value);
}

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

export function isPercentValue(value: string | number) {
  return PERCENT_REGEX.test(String(value));
}

export function isQuantityValue(value: number) {
  return Number.isInteger(value) && value >= 0;
}

export function buildRequiredUsernameSchema(label = '用户名') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isUsernameValue, {
      message: `${label}必须为 4-30 位字母或数字`,
    });
}

export function buildRequiredPasswordSchema(label = '密码') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isPasswordValue, {
      message: `${label}必须为 6-16 位，且同时包含大写字母、小写字母和数字`,
    });
}

export function buildLoginPasswordSchema(label = '密码') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` });
}

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

export function buildRequiredMobileSchema(label = '手机号') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isMobileValue, {
      message: `${label}格式不正确`,
    });
}

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

export function buildRequiredEmailSchema(label = '邮箱') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isEmailValue, {
      message: `${label}格式不正确`,
    });
}

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

export function buildRequiredIdCardSchema(label = '身份证号') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isIdCardValue, {
      message: `${label}格式不正确`,
    });
}

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

export function buildRequiredRealNameSchema(label = '姓名') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isRealNameValue, {
      message: `${label}必须为 2-30 位中文、英文或中点`,
    });
}

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

export function buildRequiredBankCardSchema(label = '银行卡号') {
  return z
    .string({ required_error: `请输入${label}` })
    .trim()
    .min(1, { message: `请输入${label}` })
    .refine(isBankCardNoValue, {
      message: `${label}格式不正确`,
    });
}

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

export function buildRequiredQuantitySchema(label = '数量') {
  return z
    .number({ required_error: `请输入${label}` })
    .int(`${label}必须为非负整数`)
    .min(0, `${label}必须为非负整数`);
}

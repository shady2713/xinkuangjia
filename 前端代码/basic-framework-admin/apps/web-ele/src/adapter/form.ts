import type {
  VbenFormSchema as FormSchema,
  VbenFormProps,
} from '@vben/common-ui';

import type { ComponentType } from './component';

import { setupVbenForm, useVbenForm as useForm, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

import {
  buildLoginPasswordSchema,
  buildOptionalBankCardSchema,
  buildOptionalEmailSchema,
  buildOptionalIdCardSchema,
  buildOptionalMobileSchema,
  buildOptionalPercentSchema,
  buildOptionalRealNameSchema,
  buildRequiredBankCardSchema,
  buildRequiredEmailSchema,
  buildRequiredIdCardSchema,
  buildRequiredMobileSchema,
  buildRequiredPasswordSchema,
  buildRequiredPercentSchema,
  buildRequiredQuantitySchema,
  buildRequiredRealNameSchema,
  buildRequiredUsernameSchema,
  DEFAULT_DATE_FORMAT,
  DEFAULT_DATETIME_FORMAT,
  isBankCardNoValue,
  isEmailValue,
  isIdCardValue,
  isMobileValue,
  isPasswordValue,
  isPercentValue,
  isQuantityValue,
  isRealNameValue,
  isUsernameValue,
} from './field-rules';

type RuleContext = Record<string, any>;
type RuleHandler = (
  value: unknown,
  params: unknown,
  ctx: RuleContext,
) => boolean | string;

/** 判断必填值是否为空；value 为控件值，空白文本和空列表无效，0 与 false 有效。 */
function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || String(value).trim().length === 0
  );
}

/** 按字段标签生成必填提示；label 为界面名称，action 为操作类型，返回统一文案。 */
function getRequiredFieldMessage(
  label: string,
  action: 'input' | 'select' | 'upload' = 'input',
): string {
  // 上传控件使用上传动作；输入与选择沿用框架现有文案模板。
  if (action === 'upload') return `请上传${label}`;
  return $t(
    `ui.formRules.${action === 'select' ? 'selectRequired' : 'required'}`,
    [label],
  );
}

const defineRules: Record<string, RuleHandler> = {
  /** 校验输入值；value 为控件值，ctx 提供字段标签，返回通过状态或字段错误。 */
  required: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return getRequiredFieldMessage(ctx.label);
    }
    return true;
  },
  /** 校验选择值；清空单选或多选均不通过，数值 0 和布尔 false 保持有效。 */
  selectRequired: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return getRequiredFieldMessage(ctx.label, 'select');
    }
    return true;
  },
  /** 校验上传值；value 为文件地址或列表，ctx 提供字段标签，返回通过状态或上传提示。 */
  uploadRequired: (value, _params, ctx) => {
    return !isEmpty(value) || getRequiredFieldMessage(ctx.label, 'upload');
  },
  username: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return (
      isUsernameValue(String(value)) || `${ctx.label}必须为 4-30 位字母或数字`
    );
  },
  usernameRequired: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return $t('ui.formRules.required', [ctx.label]);
    }
    return (
      isUsernameValue(String(value)) || `${ctx.label}必须为 4-30 位字母或数字`
    );
  },
  password: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return (
      isPasswordValue(String(value)) ||
      `${ctx.label}必须为 6-16 位，且同时包含大写字母、小写字母和数字`
    );
  },
  passwordRequired: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return $t('ui.formRules.required', [ctx.label]);
    }
    return (
      isPasswordValue(String(value)) ||
      `${ctx.label}必须为 6-16 位，且同时包含大写字母、小写字母和数字`
    );
  },
  mobile: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return (
      isMobileValue(String(value)) || $t('ui.formRules.mobile', [ctx.label])
    );
  },
  mobileRequired: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return $t('ui.formRules.required', [ctx.label]);
    }
    return (
      isMobileValue(String(value)) || $t('ui.formRules.mobile', [ctx.label])
    );
  },
  email: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return isEmailValue(String(value)) || `${ctx.label}格式不正确`;
  },
  emailRequired: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return $t('ui.formRules.required', [ctx.label]);
    }
    return isEmailValue(String(value)) || `${ctx.label}格式不正确`;
  },
  idCard: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return isIdCardValue(String(value)) || `${ctx.label}格式不正确`;
  },
  realName: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return (
      isRealNameValue(String(value)) ||
      `${ctx.label}必须为 2-30 位中文、英文或中点`
    );
  },
  bankCardNo: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return isBankCardNoValue(String(value)) || `${ctx.label}格式不正确`;
  },
  percent: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return (
      isPercentValue(String(value)) ||
      `${ctx.label}必须在 0-100 之间，最多保留两位小数`
    );
  },
  quantity: (value, _params, ctx) => {
    if (isEmpty(value)) {
      return true;
    }
    return isQuantityValue(Number(value)) || `${ctx.label}必须为非负整数`;
  },
};

async function initSetupVbenForm() {
  setupVbenForm<ComponentType>({
    config: {
      modelPropNameMap: {
        Upload: 'fileList',
        CheckboxGroup: 'model-value',
      },
    },
    defineRules: defineRules as any,
  });
}

const useVbenForm = useForm<ComponentType>;

export {
  buildLoginPasswordSchema,
  buildOptionalBankCardSchema,
  buildOptionalEmailSchema,
  buildOptionalIdCardSchema,
  buildOptionalMobileSchema,
  buildOptionalPercentSchema,
  buildOptionalRealNameSchema,
  buildRequiredBankCardSchema,
  buildRequiredEmailSchema,
  buildRequiredIdCardSchema,
  buildRequiredMobileSchema,
  buildRequiredPasswordSchema,
  buildRequiredPercentSchema,
  buildRequiredQuantitySchema,
  buildRequiredRealNameSchema,
  buildRequiredUsernameSchema,
  DEFAULT_DATE_FORMAT,
  DEFAULT_DATETIME_FORMAT,
  getRequiredFieldMessage,
  initSetupVbenForm,
  isBankCardNoValue,
  isEmailValue,
  isIdCardValue,
  isMobileValue,
  isPasswordValue,
  isPercentValue,
  isQuantityValue,
  isRealNameValue,
  isUsernameValue,
  useVbenForm,
  z,
};

export type VbenFormSchema = FormSchema<ComponentType>;
export type { VbenFormProps };

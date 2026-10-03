import type {
  VbenFormSchema as FormSchema,
  FormValues,
  FormValuesConstraint,
  NamedFormRule,
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

/** 判断必填值是否为空；value 为控件值，空白文本和空列表无效，0 与 false 有效。 */
function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || String(value).trim().length === 0
  );
}

/**
 * 按字段标签生成必填提示。
 * @param label 界面名称；vee-validate 在字段未声明 label 时给出 undefined，此处按空名处理。
 * @param action 操作类型，决定使用上传还是输入/选择的文案模板。
 * @returns 拼接完成的必填提示。
 */
function getRequiredFieldMessage(
  label: string | undefined,
  action: 'input' | 'select' | 'upload' = 'input',
): string {
  const name = label ?? '';
  // 上传控件使用上传动作；输入与选择沿用框架现有文案模板。
  if (action === 'upload') return `请上传${name}`;
  return $t(
    `ui.formRules.${action === 'select' ? 'selectRequired' : 'required'}`,
    [name],
  );
}

/** 本应用的命名规则集合：规则签名直接对齐 form-ui 的 NamedFormRule 契约。 */
const defineRules: Record<string, NamedFormRule> = {
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

/**
 * 在应用启动时登记本应用的表单适配配置。
 * 控件映射与命名规则都属于全局一次性注册，因此这里保持幂等：重复调用只会覆盖为同一份配置。
 * @returns 注册完成后兑现的 Promise；调用方无需等待具体结果。
 */
async function initSetupVbenForm() {
  setupVbenForm<ComponentType>({
    config: {
      modelPropNameMap: {
        Upload: 'fileList',
        CheckboxGroup: 'model-value',
      },
    },
    defineRules,
  });
}

/**
 * 创建表单组件与操作实例。
 * 组件集合固定为本应用注册的 Element Plus 组件，值类型由调用方声明，
 * 因此 `formApi.getValues()` 直接返回业务 DTO，不再需要断言。
 * @param options 表单属性。
 * @returns `[Form, formApi]`。
 */
const useVbenForm = <
  TComp extends ComponentType = ComponentType,
  TValues extends FormValuesConstraint = FormValues,
>(
  options: VbenFormProps<TComp, TValues>,
) => useForm<TComp, TValues>(options);

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
export type { ComponentType, FormValues, FormValuesConstraint, VbenFormProps };

/**
 * 表单项上下文读取器：注入 FormItem 的 id 前缀与 vee-validate 字段上下文，
 * 汇总 error、isDirty、isTouched、valid 以及控件、描述、消息三个 id。
 * 只在 FormField 内可用，取不到字段上下文时直接抛错；
 * 它不注册字段也不触发校验，校验规则仍由外部校验模式提供。
 */
import { inject } from 'vue';

import {
  FieldContextKey,
  useFieldError,
  useIsFieldDirty,
  useIsFieldTouched,
  useIsFieldValid,
} from 'vee-validate';

import { FORM_ITEM_INJECTION_KEY } from './injectionKeys';

/**
 * 在 FormField 作用域内读取字段上下文，拼出控件、说明、消息三个关联 id，并汇总 vee-validate 的校验状态。
 * 必须在 vee-validate 的 FormField 之内调用，否则 inject 拿不到字段上下文而抛错；它不注册字段也不触发校验。
 * @returns 含 name、id、formItemId、formDescriptionId、formMessageId 以及 error、isDirty、isTouched、valid 的对象；后四项是 vee-validate 的 computed ref，error 为空串表示当前无错误，id 在缺少 FormItem 包裹时为 undefined，三个派生 id 会因此带 undefined 前缀。
 * @throws 调用位置不在 FormField 内、inject 取不到 vee-validate 字段上下文时抛出，提示该 hook 必须在 FormField 内使用。
 */
export function useFormField() {
  const fieldContext = inject(FieldContextKey);
  const fieldItemContext = inject(FORM_ITEM_INJECTION_KEY);

  if (!fieldContext)
    throw new Error('useFormField should be used within <FormField>');

  const { name } = fieldContext;
  const id = fieldItemContext;

  const fieldState = {
    error: useFieldError(name),
    isDirty: useIsFieldDirty(name),
    isTouched: useIsFieldTouched(name),
    valid: useIsFieldValid(name),
  };

  return {
    formDescriptionId: `${id}-form-item-description`,
    formItemId: `${id}-form-item`,
    formMessageId: `${id}-form-item-message`,
    id,
    name,
    ...fieldState,
  };
}

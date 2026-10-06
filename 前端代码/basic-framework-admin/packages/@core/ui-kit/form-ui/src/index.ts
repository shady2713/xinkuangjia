/**
 * form-ui 对外出口：导出 useVbenForm、setupVbenForm
 * 与表单类型，并转出 zod 校验库。
 * 渲染层组件与实例类不在此暴露。
 */
export { setupVbenForm } from './config';

export type {
  BaseFormComponentType,
  ExtendedFormApi,
  FormValues,
  FormValuesConstraint,
  NamedFormRule,
  VbenFormProps,
  FormSchema as VbenFormSchema,
} from './types';

export * from './use-form';
export * as z from 'zod';

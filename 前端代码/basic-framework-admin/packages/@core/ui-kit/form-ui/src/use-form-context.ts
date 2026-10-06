/**
 * 表单上下文与初始化：创建 vee-validate 实例、推导字段初始值。
 * 渲染组件用 injectFormProps 取属性，容器用
 * provideComponentRefMap 交出字段引用。
 * 提交由 FormApi 承担，不在此处理。
 */
import type { ZodRawShape } from 'zod';

import type { ComputedRef } from 'vue';

import type {
  ExtendedFormApi,
  FormActions,
  FormValues,
  VbenFormProps,
} from './types';

import { computed, unref, useSlots } from 'vue';

import { createContext } from '@vben-core/shadcn-ui';
import { isString, mergeWithArrayOverride, set } from '@vben-core/shared/utils';

import { useForm } from 'vee-validate';
import { object, ZodIntersection, ZodNumber, ZodObject, ZodString } from 'zod';
import { getDefaultsForSchema } from 'zod-defaults';

/**
 * 渲染层实际接收到的属性：在通用表单属性上补一个可选实例引用，
 * 使同一套渲染逻辑既能服务 useVbenForm 的带实例表单，也能服务纯静态表单。
 */
type ExtendFormProps = VbenFormProps & { formApi?: ExtendedFormApi };

/**
 * 表单属性与 vee-validate 上下文的注入/提供对。
 * 字段子树用 injectFormProps 取值；取到的是响应式引用或普通对象，
 * 容器用 provideFormProps 下发真实上下文，缺少 provide 时 inject 侧会抛错。
 */
export const [injectFormProps, provideFormProps] =
  createContext<[ComputedRef<ExtendFormProps> | ExtendFormProps, FormActions]>(
    'VbenFormProps',
  );

/** 字段名到控件实例引用的注入/提供对：字段把自己的实例登记进来，供聚焦定位与滚动定位使用。 */
export const [injectComponentRefMap, provideComponentRefMap] =
  createContext<Map<string, unknown>>('ComponentRefMap');

/**
 * 根据表单定义创建 vee-validate 实例并推导初始值。
 * 只在组件创建时执行一次，调用方不需要手动销毁。
 * @param props 当前表单属性（响应式或普通对象均可）。
 * @returns 委托插槽名与真实 vee-validate 表单上下文。
 */
export function useFormInitial(
  props: ComputedRef<VbenFormProps> | VbenFormProps,
) {
  const slots = useSlots();
  const initialValues = generateInitialValues();

  const form = useForm({
    ...(Object.keys(initialValues)?.length ? { initialValues } : {}),
  });

  /**
   * 收集需要原样透传给渲染层的具名插槽名。
   * `default` 插槽由渲染层自己处理并挂上默认操作按钮，因此不计入其中。
   */
  const delegatedSlots = computed(() => {
    const resultSlots: string[] = [];

    for (const key of Object.keys(slots)) {
      if (key !== 'default') {
        resultSlots.push(key);
      }
    }
    return resultSlots;
  });

  /**
   * 收集 schema 中显式声明的 defaultValue 与 zod 规则可推导的默认值。
   * 字段名支持点号路径，因此按路径写入而不是平铺。
   * @returns 需要写入 useForm 的 initialValues；无默认值时返回空对象。
   */
  function generateInitialValues(): FormValues {
    const initialValues: FormValues = {};

    const zodObject: ZodRawShape = {};
    (unref(props).schema || []).forEach((item) => {
      if (Reflect.has(item, 'defaultValue')) {
        set(initialValues, item.fieldName, item.defaultValue);
      } else if (item.rules && !isString(item.rules)) {
        // 检查规则是否适合提取默认值
        const customDefaultValue = getCustomDefaultValue(item.rules);
        zodObject[item.fieldName] = item.rules;
        if (customDefaultValue !== undefined) {
          initialValues[item.fieldName] = customDefaultValue;
        }
      }
    });

    const schemaInitialValues = getDefaultsForSchema(object(zodObject));

    const zodDefaults: FormValues = {};
    for (const key in schemaInitialValues) {
      set(zodDefaults, key, schemaInitialValues[key]);
    }
    return mergeWithArrayOverride(initialValues, zodDefaults);
  }
  /**
   * 从 zod 规则推导控件初始值，避免把 undefined 交给受控组件。
   * @param rule 字段规则。
   * @returns 与规则类型匹配的初始值；无法识别的规则返回 undefined，表示不提供默认值。
   */
  function getCustomDefaultValue(rule: unknown): unknown {
    if (rule instanceof ZodString) {
      return ''; // 默认为空字符串
    } else if (rule instanceof ZodNumber) {
      return null; // 默认为 null（避免显示 0）
    } else if (rule instanceof ZodObject) {
      // 递归提取嵌套对象的默认值
      const defaultValues: FormValues = {};
      for (const [key, valueSchema] of Object.entries(rule.shape)) {
        defaultValues[key] = getCustomDefaultValue(valueSchema);
      }
      return defaultValues;
    } else if (rule instanceof ZodIntersection) {
      // 对于交集类型，从schema 提取默认值
      const leftDefaultValue = getCustomDefaultValue(rule._def.left);
      const rightDefaultValue = getCustomDefaultValue(rule._def.right);

      // 如果左右两边都能提取默认值，合并它们
      if (
        typeof leftDefaultValue === 'object' &&
        typeof rightDefaultValue === 'object'
      ) {
        return { ...leftDefaultValue, ...rightDefaultValue };
      }

      // 否则优先使用左边的默认值
      return leftDefaultValue ?? rightDefaultValue;
    } else {
      return undefined; // 其他类型不提供默认值
    }
  }

  return {
    delegatedSlots,
    form,
  };
}

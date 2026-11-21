/** 表单上下文、初始值推导（Zod v3 兼容）与插槽代理逻辑。 */
import type { ZodRawShape, ZodTypeAny } from 'zod';

import type { ComputedRef } from 'vue';

import type { ExtendedFormApi, FormActions, VbenFormProps } from './types';

import { computed, unref, useSlots } from 'vue';

import { createContext } from '@vben-core/shadcn-ui';
import { isString, mergeWithArrayOverride, set } from '@vben-core/shared/utils';

import { useForm } from 'vee-validate';
import {
  object,
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodEffects,
  ZodIntersection,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodPipeline,
  ZodRecord,
  ZodString,
  ZodTuple,
  ZodUnion,
} from 'zod';

/**
 * 递归提取 Zod v3 字段 schema 的默认值，替代仅兼容 Zod v4 的 `zod-defaults`。
 *
 * @param schema 单个字段的 Zod v3 规则节点
 * @returns 推导出的字段默认值；无显式或内置默认值时返回 undefined
 */
function getZodFieldDefault(schema: ZodTypeAny): unknown {
  if (schema instanceof ZodDefault) return schema._def.defaultValue();
  if (schema instanceof ZodEffects)
    return getZodFieldDefault(schema._def.schema);
  if (schema instanceof ZodPipeline) return getZodFieldDefault(schema._def.in);
  if (schema instanceof ZodOptional) {
    const inner = schema._def.innerType;
    return inner instanceof ZodDefault ? inner._def.defaultValue() : undefined;
  }
  if (schema instanceof ZodBoolean) return false;
  if (schema instanceof ZodNumber) return 0;
  if (schema instanceof ZodString) return '';
  if (schema instanceof ZodArray) return [];
  if (schema instanceof ZodRecord) return {};
  if (schema instanceof ZodTuple) {
    return (schema._def.items as ZodTypeAny[]).map(
      /** 逐项推导元组元素的默认值。 */
      (item) => getZodFieldDefault(item),
    );
  }
  if (schema instanceof ZodUnion) {
    return getZodFieldDefault(schema._def.options[0]);
  }
  if (schema instanceof ZodObject || schema instanceof ZodIntersection) {
    return getDefaultsForSchema(schema);
  }
  return undefined;
}

/**
 * 提取 Zod v3 对象或交集 schema 的初始默认值映射。
 *
 * @param schema 顶层对象、管道或交集 Zod v3 schema
 * @returns 过滤掉 undefined 后的默认值键值对象
 */
export function getDefaultsForSchema(schema: ZodTypeAny): Record<string, any> {
  if (schema instanceof ZodRecord) return {};
  if (schema instanceof ZodEffects)
    return getDefaultsForSchema(schema._def.schema);
  if (schema instanceof ZodPipeline)
    return getDefaultsForSchema(schema._def.in);
  if (schema instanceof ZodIntersection) {
    return {
      ...getDefaultsForSchema(schema._def.left),
      ...getDefaultsForSchema(schema._def.right),
    };
  }
  if (schema instanceof ZodUnion) {
    const match = (schema._def.options as ZodTypeAny[]).find(
      /** 在联合类型中查找首个对象分支作为默认结构来源。 */
      (option) => option instanceof ZodObject,
    );
    return match ? getDefaultsForSchema(match) : {};
  }
  if (!(schema instanceof ZodObject)) return {};
  const entries = Object.entries(schema.shape as Record<string, ZodTypeAny>)
    .map(
      /** 逐字段计算默认值并组装为键值二元组。 */
      ([key, field]) => [key, getZodFieldDefault(field)] as const,
    )
    .filter(
      /** 过滤无默认值的字段，避免覆盖外部传入的初始值。 */
      ([, value]) => value !== undefined,
    );
  return Object.fromEntries(entries);
}

type ExtendFormProps = VbenFormProps & { formApi?: ExtendedFormApi };

export const [injectFormProps, provideFormProps] =
  createContext<[ComputedRef<ExtendFormProps> | ExtendFormProps, FormActions]>(
    'VbenFormProps',
  );

export const [injectComponentRefMap, provideComponentRefMap] =
  createContext<Map<string, unknown>>('ComponentRefMap');

export function useFormInitial(
  props: ComputedRef<VbenFormProps> | VbenFormProps,
) {
  const slots = useSlots();
  const initialValues = generateInitialValues();

  const form = useForm({
    ...(Object.keys(initialValues)?.length ? { initialValues } : {}),
  });

  const delegatedSlots = computed(() => {
    const resultSlots: string[] = [];

    for (const key of Object.keys(slots)) {
      if (key !== 'default') {
        resultSlots.push(key);
      }
    }
    return resultSlots;
  });

  function generateInitialValues() {
    const initialValues: Record<string, any> = {};

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

    const zodDefaults: Record<string, any> = {};
    for (const key in schemaInitialValues) {
      set(zodDefaults, key, schemaInitialValues[key]);
    }
    return mergeWithArrayOverride(initialValues, zodDefaults);
  }
  // 自定义默认值提取逻辑
  function getCustomDefaultValue(rule: any): any {
    if (rule instanceof ZodString) {
      return ''; // 默认为空字符串
    } else if (rule instanceof ZodNumber) {
      return null; // 默认为 null（避免显示 0）
    } else if (rule instanceof ZodObject) {
      // 递归提取嵌套对象的默认值
      const defaultValues: Record<string, any> = {};
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

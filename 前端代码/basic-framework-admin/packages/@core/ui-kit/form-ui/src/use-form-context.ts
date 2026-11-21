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
  ZodCatch,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodIntersection,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodPipeline,
  ZodReadonly,
  ZodRecord,
  ZodString,
  ZodTuple,
  ZodUnion,
} from 'zod';

/**
 * 仅提取包装节点内显式声明的 `ZodDefault` 默认值，不为空值可选/可空字段合成基础类型零值。
 *
 * @param schema 被包装的 Zod v3 规则节点
 * @returns 显式默认值；不存在时返回 undefined
 */
function unwrapExplicitDefault(schema: ZodTypeAny): unknown {
  if (schema instanceof ZodDefault) return schema._def.defaultValue();
  if (schema instanceof ZodEffects)
    return unwrapExplicitDefault(schema._def.schema);
  if (schema instanceof ZodPipeline)
    return unwrapExplicitDefault(schema._def.in);
  if (
    schema instanceof ZodOptional ||
    schema instanceof ZodNullable ||
    schema instanceof ZodCatch ||
    schema instanceof ZodReadonly
  ) {
    return unwrapExplicitDefault(schema._def.innerType);
  }
  return undefined;
}

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
  if (schema instanceof ZodCatch || schema instanceof ZodReadonly) {
    return getZodFieldDefault(schema._def.innerType);
  }
  if (schema instanceof ZodOptional || schema instanceof ZodNullable) {
    return unwrapExplicitDefault(schema._def.innerType);
  }
  if (schema instanceof ZodBoolean) return false;
  // 裸 ZodNumber 交由 getCustomDefaultValue 保持 null，避免 defu 用 0 覆盖 null。
  if (schema instanceof ZodNumber) return undefined;
  if (schema instanceof ZodString) return '';
  if (schema instanceof ZodArray) return [];
  if (schema instanceof ZodRecord) return {};
  if (schema instanceof ZodTuple) {
    return (schema._def.items as ZodTypeAny[]).map(
      /** 逐项推导元组元素的默认值。 */
      (item) => getZodFieldDefault(item),
    );
  }
  if (schema instanceof ZodUnion || schema instanceof ZodDiscriminatedUnion) {
    const first = (schema._def.options as ZodTypeAny[])[0];
    return first ? getZodFieldDefault(first) : undefined;
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
  if (schema instanceof ZodCatch || schema instanceof ZodReadonly) {
    return getDefaultsForSchema(schema._def.innerType);
  }
  if (schema instanceof ZodIntersection) {
    return {
      ...getDefaultsForSchema(schema._def.left),
      ...getDefaultsForSchema(schema._def.right),
    };
  }
  if (schema instanceof ZodUnion || schema instanceof ZodDiscriminatedUnion) {
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

/**
 * 初始化表单实例、初始默认值与可透传的具名插槽列表。
 *
 * @param props 表单属性或其响应式引用
 * @returns 包含具名插槽列表与 vee-validate 表单实例的对象
 */
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
  /**
   * 按表单字段 Zod 规则提取自定义初始默认值（数字默认 null 以避免误填 0）。
   *
   * @param rule 字段 Zod 校验规则
   * @returns 推导出的初始默认值；不适用时返回 undefined
   */
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

      // 如果左右两边都能提取非空对象默认值，合并它们
      if (
        leftDefaultValue !== null &&
        rightDefaultValue !== null &&
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

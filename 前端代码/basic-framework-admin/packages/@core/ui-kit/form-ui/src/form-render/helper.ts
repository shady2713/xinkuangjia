/** 仅通过 Zod 实例及事件的实际形状解析运行时对象。 */
import { ZodDefault, ZodEffects, ZodNullable, ZodOptional, ZodType } from 'zod';

/** 沿已知包装类型提取最内层 Zod 规则，字符串命名规则返回空。
 * @param schema 字段声明的规则。
 * @returns 最内层有效规则，或没有 Zod 规则时的 null。
 */
export function getBaseRules(schema: unknown): null | ZodType<unknown> {
  if (schema instanceof ZodDefault) return getBaseRules(schema.removeDefault());
  if (schema instanceof ZodEffects) return getBaseRules(schema.innerType());
  if (schema instanceof ZodOptional || schema instanceof ZodNullable)
    return getBaseRules(schema.unwrap());
  return schema instanceof ZodType ? schema : null;
}

/** 从实际 Zod 包装链读取默认值，不假定任意规则都是 ZodDefault。
 * @param schema 字段声明的规则。
 * @returns 声明的未知默认值，未声明时返回 undefined。
 */
export function getDefaultValueInZodStack(schema: unknown): unknown {
  if (schema instanceof ZodDefault) return schema._def.defaultValue();
  if (schema instanceof ZodEffects)
    return getDefaultValueInZodStack(schema.innerType());
  if (schema instanceof ZodOptional || schema instanceof ZodNullable)
    return getDefaultValueInZodStack(schema.unwrap());
  return undefined;
}

/** 判断值是否为可通过字符串键访问的非数组对象。
 * @param value 待收窄值。
 * @returns 是否具有对象形状。
 */
export function isValueRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 判断 DOM 或第三方控件事件是否包含可访问目标与停止传播方法。
 * @param value 待识别的控件事件或直接字段值。
 * @returns 是否可安全读取事件目标字段。
 */
export function isEventObjectLike(
  value: unknown,
): value is { target: Record<string, unknown> } {
  return (
    isValueRecord(value) &&
    isValueRecord(value.target) &&
    typeof value.stopPropagation === 'function'
  );
}

/**
 * 按 插槽 > attrs > props > state 的优先级解析组件字段值。
 *
 * 关键约束是求值时机：computed getter 惰性求值，首次读取往往发生在事件回调里，
 * 那时没有 active instance。因此组件上下文必须在 composable 创建时固化，
 * 而 attrs/slots 的响应式依赖必须经由 useAttrs()/useSlots() 建立。
 */
import type { ComponentInternalInstance, ComputedRef, Ref, Slots } from 'vue';

import { computed, getCurrentInstance, unref, useAttrs, useSlots } from 'vue';

import {
  getFirstNonNullOrUndefined,
  kebabToCamelCase,
} from '@vben-core/shared/utils';

/**
 * 按字段名从外部状态中读取值。
 * @description state 的实际类型与 props 无关，两个泛型之间无法直接互转键名，
 * 因此这里按字符串键只读自有属性，字段不存在时返回 undefined。
 * @param source 外部状态对象，可为空
 * @param key 字段名
 * @returns 字段值；对象为空或字段不存在时为 undefined
 */
function readStateValue(source: object | undefined, key: string): unknown {
  if (!source || !Object.hasOwn(source, key)) {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(source, key)?.value;
}

/**
 * 创建期固化的组件上下文快照。
 * @description computed getter 是惰性求值的，首次求值通常发生在事件回调或渲染副作用内，
 * 那时已不存在 active instance，`getCurrentInstance()`、`useSlots()`、`useAttrs()` 会读到 null
 * （弹窗的 Escape、打开焦点、点击外部回调正是这种时机）。
 * 因此上下文必须在 composable 创建（setup 期间）时取出，getter 内只做纯读取。
 * `instance` 保存实例对象本身而不是当时的 vnode，getter 仍能读到最新 vnode 的 props。
 */
interface PriorityValueContext {
  /** 组件透传 attrs；由 useAttrs 提供，读取其中字段会建立响应式依赖。 */
  attrs: Record<string, unknown>;
  /** 组件实例；在 setup 之外创建时为 null。 */
  instance: ComponentInternalInstance | null;
  /** 组件插槽；由 useSlots 提供，setup 之外为空对象。 */
  slots: Slots;
}

/**
 * 依次从插槽、attrs、props、state 中获取值
 * @description 泛型约束只要求 props/state 是对象，不使用索引签名，
 * 否则 Dept[]、Menu[] 这类数组 state 会因为缺少字符串索引签名而无法传入。
 * @param key 要读取的字段名
 * @param props 组件声明的 props
 * @param state 外部状态，可为空
 * @returns 按 插槽 > attrs > props > state 优先级解析出的字段值
 */
export function usePriorityValue<
  T extends object,
  S extends object,
  K extends keyof T = keyof T,
>(key: K, props: T, state: Readonly<Ref<NoInfer<S>>> | undefined) {
  const instance = getCurrentInstance();
  // 实例为空说明调用点不在 setup 内：此时不调用 useSlots/useAttrs（它们会抛 TypeError），
  // 退化为无插槽、无 attrs，让 props/state 仍可解析。
  //
  // 这里必须保留 useSlots/useAttrs，不能改读 instance.slots/instance.attrs：
  // Vue 3.5 的 attrs/slots 本身不是响应式对象，依赖由 setupContext 的开发态 Proxy 建立
  // （attrs 为 track(target, 'get', '')，slots 为 track(instance, 'get', '$slots')），
  // 对应 Vue 内部的 trigger(instance.attrs, 'set', '') 与 trigger(instance, 'set', '$slots')。
  // 直接读原始对象会丢掉这条依赖，导致 attrs/slots 变化后 computed 不再重新解析。
  const context: PriorityValueContext = instance
    ? {
        attrs: useAttrs() as Record<string, unknown>,
        instance,
        slots: useSlots(),
      }
    : { attrs: {}, instance, slots: {} };
  /** 任一来源（插槽/attrs/props/state）变化都会重新解析出该字段的值。 */
  const resolve = (): T[K] => resolvePriorityValue(key, props, state, context);
  const value = computed(resolve);
  return value;
}

/**
 * 按 插槽 > attrs > props > state 的顺序解析出字段值。
 * @description 抽成具名函数以便单测直接覆盖各来源的优先级；slot 可以关闭。
 * 上下文来自 composable 创建期的快照，这里不再读取 Vue 的 active instance。
 * @param key 要读取的字段名
 * @param props 组件声明的 props
 * @param state 外部状态，可为空
 * @param context 创建期固化的组件上下文快照
 * @returns 第一个非 null/undefined 的来源值；全部为空时为 undefined
 */
function resolvePriorityValue<
  T extends object,
  S extends object,
  K extends keyof T,
>(
  key: K,
  props: T,
  state: Readonly<Ref<NoInfer<S>>> | undefined,
  context: PriorityValueContext,
): T[K] {
  const { attrs, instance, slots } = context;

  // props不管有没有传，都会有默认值，会影响这里的顺序，
  // 通过判断原始props是否有值来判断是否传入
  const rawProps = (instance?.vnode?.props || {}) as T;

  const standardRawProps = {} as T;

  for (const [rawKey, rawValue] of Object.entries(rawProps)) {
    standardRawProps[kebabToCamelCase(rawKey) as K] = rawValue;
  }
  const propsKey =
    standardRawProps?.[key] === undefined ? undefined : props[key];

  // 四个来源的值类型互不相同，这里统一按 unknown 收集后回落到 T[K]
  return getFirstNonNullOrUndefined<unknown>(
    slots[key as string],
    attrs[key as string],
    propsKey,
    readStateValue(state?.value, key as string),
  ) as T[K];
}

/**
 * 批量获取state中的值（每个值都是ref）
 * @param props 组件声明的 props，字段名决定返回对象的键
 * @param state 外部状态，可为空
 * @returns 与 props 字段一一对应的 ComputedRef 映射
 */
export function usePriorityValues<
  T extends object,
  S extends Ref<object> = Readonly<Ref<NoInfer<T>, NoInfer<T>>>,
>(props: T, state: S | undefined) {
  const result: { [K in keyof T]: ComputedRef<T[K]> } = {} as never;

  (Object.keys(props) as (keyof T)[]).forEach((key) => {
    result[key] = usePriorityValue(key as keyof typeof props, props, state);
  });

  return result;
}

/**
 * 解包一批 ComputedRef，得到与 props 字段一一对应的普通对象。
 * @description 供 useForwardPriorityValues 聚合成单个 computed 透传时使用。
 * @param source ComputedRef 映射
 * @returns 解包后的普通对象
 */
function unwrapAll<T extends object>(source: {
  [K in keyof T]: ComputedRef<T[K]>;
}): { [K in keyof T]: T[K] } {
  const unwrapResult: Record<string, unknown> = {};
  for (const key of Object.keys(source) as (keyof T)[]) {
    unwrapResult[key as string] = unref(source[key]);
  }
  return unwrapResult as { [K in keyof T]: T[K] };
}

/**
 * 批量获取state中的值（集中在一个computed，用于透传）
 * @param props 组件声明的 props，字段名决定返回对象的键
 * @param state 外部状态，可为空
 * @returns 单个 ComputedRef，解包后为与 props 字段一一对应的普通对象
 */
export function useForwardPriorityValues<
  T extends object,
  S extends Ref<object> = Readonly<Ref<NoInfer<T>, NoInfer<T>>>,
>(props: T, state: S | undefined) {
  const computedResult: { [K in keyof T]: ComputedRef<T[K]> } = {} as never;

  for (const key of Object.keys(props) as (keyof T)[]) {
    computedResult[key] = usePriorityValue(
      key as keyof typeof props,
      props,
      state,
    );
  }

  /** 聚合成单个 computed 透传；任一字段的来源变化都会触发整体重新解包。 */
  const forward = () => unwrapAll(computedResult);
  return computed(forward);
}

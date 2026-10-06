/** 表单项联动状态机：把依赖字段的取值变化翻译成本字段的显隐、禁用、必填、规则与参数。 */
import type { Recordable } from '@vben-core/typings';

import type {
  FormItemDependencies,
  FormSchemaRuleType,
  MaybeComponentProps,
} from '../types';

import { computed, onScopeDispose, ref, watch } from 'vue';

import { get, isBoolean, isFunction } from '@vben-core/shared/utils';

import { useFormValues } from 'vee-validate';

import { injectRenderFormProps } from './context';

/**
 * 解析字段值，兼容 vee-validate 的嵌套禁用语法。
 * @param values 当前表单值。
 * @param fieldName schema 中的字段名，`[key]` 表示不解析嵌套路径。
 * @returns 该字段的原始值。
 */
function resolveValueByFieldName(
  values: Partial<Recordable<unknown>>,
  fieldName: string,
): unknown {
  // vee-validate：[] 表示禁用嵌套
  if (fieldName.startsWith('[') && fieldName.endsWith(']')) {
    const rawKey = fieldName.slice(1, -1);
    return values[rawKey];
  }

  return get(values, fieldName);
}

/**
 * 计算表单项的联动状态（显示、隐藏、禁用、必填、动态规则与动态参数）。
 *
 * 联动回调可以是异步的，因此按触发次序编号：只有最新一次触发的结果会被写回，
 * 迟到的旧结果被丢弃，避免快速连续操作时旧值覆盖新值。
 * 组件销毁时停止监听并使在途结果失效，迟到写入不会发生。
 *
 * @param getDependencies 返回当前表单项的依赖声明。
 * @returns 联动计算结果，全部为响应式引用。
 * @throws {Error} 未在 `VbenForm` 内部使用，拿不到表单值上下文。
 */
export default function useDependencies(
  getDependencies: /** 当前依赖声明 */ () => FormItemDependencies | undefined,
) {
  const values = useFormValues();

  const formRenderProps = injectRenderFormProps();

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const formApi = formRenderProps.form!;

  if (!values) {
    throw new Error('useDependencies should be used within <VbenForm>');
  }

  const isIf = ref(true);
  const isDisabled = ref(false);
  const isShow = ref(true);
  const isRequired = ref(false);
  const dynamicComponentProps = ref<MaybeComponentProps>({});
  const dynamicRules = ref<FormSchemaRuleType>();

  /** 联动触发次序；只有与当前次序一致的结果才允许写回。 */
  let triggerToken = 0;
  /** 组件销毁后置位，阻止在途异步结果落地。 */
  let disposed = false;

  /** 依赖字段的当前取值列表，作为监听的触发源；只有一个依赖字段变化才会重新计算联动。 */
  const triggerFieldValues = computed(() => {
    // 该字段可能会被多个字段触发
    const triggerFields = getDependencies()?.triggerFields ?? [];
    return triggerFields.map((dep) => {
      return resolveValueByFieldName(values.value, dep);
    });
  });

  /** 把联动状态恢复到初始值，在每次重算开始时清掉上一轮留下的显隐、禁用、规则与参数。 */
  const resetConditionState = () => {
    isDisabled.value = false;
    isIf.value = true;
    isShow.value = true;
    isRequired.value = false;
    dynamicRules.value = undefined;
    dynamicComponentProps.value = {};
  };

  watch(
    [triggerFieldValues, getDependencies],
    /**
     * 按依赖字段的新值重算本字段的全部联动状态。
     * 每个 await 之后都重新确认本次触发仍然有效，链路上任一环节过期即整段放弃。
     * @param entry 被依赖字段的取值快照与本字段最新的依赖声明。
     */
    async (entry) => {
      const [_values, dependencies] = entry;
      if (!dependencies || !dependencies?.triggerFields?.length) {
        return;
      }
      const currentToken = ++triggerToken;
      // 本次触发已经过期（被更新的触发取代）或组件已销毁时，直接放弃。
      const isStale = () => disposed || currentToken !== triggerToken;
      resetConditionState();
      const {
        componentProps,
        disabled,
        if: whenIf,
        required,
        rules,
        show,
        trigger,
      } = dependencies;

      // 1. 优先判断if，如果if为false，则不渲染dom，后续判断也不再执行
      const formValues = values.value;
      if (isFunction(whenIf)) {
        const whenResult = await whenIf(formValues, formApi);
        if (isStale()) return;
        isIf.value = !!whenResult;
        // 不渲染
        if (!isIf.value) return;
      } else if (isBoolean(whenIf)) {
        isIf.value = whenIf;
        if (!isIf.value) return;
      }

      // 2. 判断show，如果show为false，则隐藏
      if (isFunction(show)) {
        const showResult = await show(formValues, formApi);
        if (isStale()) return;
        isShow.value = !!showResult;
      } else if (isBoolean(show)) {
        isShow.value = show;
      }

      if (isFunction(componentProps)) {
        const propsResult = await componentProps(formValues, formApi);
        if (isStale()) return;
        dynamicComponentProps.value = propsResult;
      }

      if (isFunction(rules)) {
        const rulesResult = await rules(formValues, formApi);
        if (isStale()) return;
        dynamicRules.value = rulesResult;
      }

      if (isFunction(disabled)) {
        const disabledResult = await disabled(formValues, formApi);
        if (isStale()) return;
        isDisabled.value = !!disabledResult;
      } else if (isBoolean(disabled)) {
        isDisabled.value = disabled;
      }

      if (isFunction(required)) {
        const requiredResult = await required(formValues, formApi);
        if (isStale()) return;
        isRequired.value = !!requiredResult;
      }

      if (isFunction(trigger)) {
        await trigger(formValues, formApi);
      }
    },
    { deep: true, immediate: true },
  );

  // 表单项随条件渲染反复创建销毁，在途异步结果不能在销毁后继续写回响应式状态。
  // 递增 triggerToken 让所有在途回调立即判定为过期，watcher 本身随作用域释放。
  onScopeDispose(
    /**
     * 作用域释放时使在途异步结果全部失效。
     * 表单项被条件渲染卸载时执行，避免旧联动结果写回已销毁的组件状态。
     */
    () => {
      disposed = true;
      triggerToken++;
    },
  );

  return {
    dynamicComponentProps,
    dynamicRules,
    isDisabled,
    isIf,
    isRequired,
    isShow,
  };
}

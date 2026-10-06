<script setup lang="ts">
/**
 * 带实例的表单渲染器：useVbenForm 生成的内部组件，把实例挂到真实表单上。
 * 向 FormApi 交出 vee-validate 上下文与字段引用，
 * 并实现回车提交、值变更防抖提交与折叠同步；
 * 不创建实例，属性以 formApi 状态优先。
 */
import type { Recordable } from '@vben-core/typings';

import type { ExtendedFormApi, VbenFormProps } from './types';

import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue';

import { useForwardPriorityValues } from '@vben-core/composables';
import { cloneDeep, get, isEqual, set } from '@vben-core/shared/utils';

import FormActions from './components/form-actions.vue';
import {
  COMPONENT_BIND_EVENT_MAP,
  COMPONENT_MAP,
  DEFAULT_FORM_COMMON_CONFIG,
} from './config';
import { Form } from './form-render';
import {
  provideComponentRefMap,
  provideFormProps,
  useFormInitial,
} from './use-form-context';

/** 停止一个已建立的监听；由 Vue 的 `watch` 返回，调用后监听不再响应。 */
type StopWatch = () => void;

// 使用 extends 会导致热更新异常，这里显式展开定义。
interface Props extends VbenFormProps {
  formApi?: ExtendedFormApi;
}

const props = defineProps<Props>();

const state = props.formApi?.useStore?.();

const forward = useForwardPriorityValues(props, state);

const componentRefMap = new Map<string, unknown>();

const { delegatedSlots, form } = useFormInitial(forward);

provideFormProps([forward, form]);
provideComponentRefMap(componentRefMap);

props.formApi?.mount?.(form, componentRefMap);

/**
 * 折叠开关变化时的写入点：先同步到实例状态，再通知业务的折叠回调。
 * 不判断折叠是否允许，点击折叠箭头即视为一次显式切换。
 */
const handleUpdateCollapsed = (value: boolean) => {
  props.formApi?.setState({ collapsed: value });
  // 同步折叠状态变化回调
  forward.value.handleCollapsedChange?.(value);
};

/**
 * 表单区域回车即提交，且只在校验通过后交给业务。
 * 焦点在 textarea 时保留换行不触发；未开启回车提交或实例尚未挂载时同样直接返回。
 * @param event 键盘事件，用于识别 textarea 焦点并阻止默认提交行为。
 */
function handleKeyDownEnter(event: KeyboardEvent) {
  if (!state?.value.submitOnEnter || !forward.value.formApi?.isMounted) {
    return;
  }
  // textarea 内保留换行，不触发表单提交。
  if (event.target instanceof HTMLTextAreaElement) {
    return;
  }
  event.preventDefault();

  forward.value.formApi?.validateAndSubmitForm();
}

const SUBMIT_DEBOUNCE_MS = 300;

/** 自动提交防抖计时器；组件销毁时必须清空，避免卸载后仍发起一次提交。 */
let submitTimer: null | ReturnType<typeof setTimeout> = null;
/** 组件销毁标记：迟到的防抖回调与在途异步结果都不再产生副作用。 */
let disposed = false;
/** 值变化监听的停止句柄；在 onMounted 的下一个 tick 才建立，卸载时可能尚未赋值。 */
let stopValuesWatch: StopWatch | undefined;

/**
 * 安排一次延迟自动提交；同一窗口内的多次变更只提交最后一次。
 * 组件销毁后不再安排，已排队的计时器由 onBeforeUnmount 取消。
 */
function scheduleAutoSubmit() {
  if (disposed) {
    return;
  }
  if (submitTimer) {
    clearTimeout(submitTimer);
  }
  submitTimer = setTimeout(
    /**
     * 防抖窗口结束后的实际提交。
     * 提交前再次确认未销毁且确实开启了变更提交，避免卸载后或未开启时发起无意义的提交。
     */
    () => {
      submitTimer = null;
      if (disposed || !state?.value.submitOnChange) return;
      forward.value.formApi?.validateAndSubmitForm();
    },
    SUBMIT_DEBOUNCE_MS,
  );
}

onBeforeUnmount(
  /**
   * 组件销毁时统一清理本组件建立的所有副作用。
   * 必须在 setup 同步阶段注册：放在 onMounted 的 await 之后会丢失组件实例上下文，
   * 卸载钩子不会生效，待执行的防抖提交与值变化监听都会泄漏到组件之外。
   */
  () => {
    disposed = true;
    stopValuesWatch?.();
    stopValuesWatch = undefined;
    if (submitTimer) {
      clearTimeout(submitTimer);
      submitTimer = null;
    }
  },
);

/** 上一次已通知业务的字段值快照，只记录 schema 中声明的字段。 */
const valuesCache: Recordable<unknown> = {};

onMounted(
  /**
   * 挂载后监听表单值变化并向外抛出变更字段。
   * 监听在 onMounted 的下一个 tick 建立，初始化赋值不会被误判为用户变更；
   * 停止句柄交给同步注册的 onBeforeUnmount 统一清理。
   */
  async () => {
    // 挂载完成后再监听，避免初始化赋值被误判为变更。
    await nextTick();
    // 上面的 await 期间组件可能已被卸载，此时不再建立监听。
    if (disposed) return;
    stopValuesWatch = watch(
      /** 取整棵表单值作为监听源，配合 deep 选项捕获字段内部变化。 */
      () => form.values,
      /**
       * 汇总本次变更的字段并通知业务，同时按需安排自动提交。
       * @param newVal 变更后的完整表单值。
       */
      async (newVal) => {
        if (forward.value.handleValuesChange) {
          const fields = state?.value.schema?.map(
            /** 只统计 schema 声明的字段，控件内部状态不参与变更判定。 */
            (item) => {
              return item.fieldName;
            },
          );

          if (fields && fields.length > 0) {
            const changedFields: string[] = [];
            fields.forEach(
              /**
               * 与上次快照逐字段比较，只有真正变化的字段才对外抛出。
               * @param field 当前比较的字段名。
               */
              (field) => {
                const newFieldValue = get(newVal, field);
                const oldFieldValue = get(valuesCache, field);
                if (!isEqual(newFieldValue, oldFieldValue)) {
                  changedFields.push(field);
                  set(valuesCache, field, newFieldValue);
                }
              },
            );

            if (changedFields.length > 0) {
              // 向外抛出最新表单值和本次变更字段
              const values = await forward.value.formApi?.getValues();
              // 读取期间组件可能已卸载，此时通知业务会操作已销毁的页面状态。
              if (disposed) return;
              forward.value.handleValuesChange(
                cloneDeep(values ?? {}),
                changedFields,
              );
            }
          }
        }
        scheduleAutoSubmit();
      },
      { deep: true },
    );
  },
);
</script>

<template>
  <Form
    @keydown.enter="handleKeyDownEnter"
    v-bind="forward"
    :collapsed="state?.collapsed"
    :component-bind-event-map="COMPONENT_BIND_EVENT_MAP"
    :component-map="COMPONENT_MAP"
    :form="form"
    :global-common-config="DEFAULT_FORM_COMMON_CONFIG"
  >
    <template
      v-for="slotName in delegatedSlots"
      :key="slotName"
      #[slotName]="slotProps"
    >
      <slot :name="slotName" v-bind="slotProps"></slot>
    </template>
    <template #default="slotProps">
      <slot v-bind="slotProps">
        <FormActions
          v-if="forward.showDefaultActions"
          :model-value="state?.collapsed"
          @update:model-value="handleUpdateCollapsed"
        >
          <template #reset-before="resetSlotProps">
            <slot name="reset-before" v-bind="resetSlotProps"></slot>
          </template>
          <template #submit-before="submitSlotProps">
            <slot name="submit-before" v-bind="submitSlotProps"></slot>
          </template>
          <template #expand-before="expandBeforeSlotProps">
            <slot name="expand-before" v-bind="expandBeforeSlotProps"></slot>
          </template>
          <template #expand-after="expandAfterSlotProps">
            <slot name="expand-after" v-bind="expandAfterSlotProps"></slot>
          </template>
        </FormActions>
      </slot>
    </template>
  </Form>
</template>

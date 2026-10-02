<script setup lang="ts">
import type { ZodType } from 'zod';

import type { FormSchema, MaybeComponentProps } from '../types';

import { computed, nextTick, onUnmounted, useTemplateRef, watch } from 'vue';

import { CircleAlert } from '@vben-core/icons';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
  VbenRenderContent,
  VbenTooltip,
} from '@vben-core/shadcn-ui';
import { cn, isFunction, isObject, isString } from '@vben-core/shared/utils';

import { toTypedSchema } from '@vee-validate/zod';
import { useFieldError, useFormValues } from 'vee-validate';

import { injectComponentRefMap } from '../use-form-context';
import { injectRenderFormProps, useFormContext } from './context';
import useDependencies from './dependencies';
import FormLabel from './form-label.vue';
import { isEventObjectLike } from './helper';

interface Props extends FormSchema {}

const {
  colon,
  commonComponentProps,
  component,
  componentProps,
  dependencies,
  description,
  disabled,
  disabledOnChangeListener,
  disabledOnInputListener,
  emptyStateValue,
  fieldName,
  formFieldProps,
  hide,
  label,
  labelClass,
  labelWidth,
  modelPropName,
  renderComponentContent,
  rules,
} = defineProps<
  Props & {
    commonComponentProps: MaybeComponentProps;
  }
>();

const { componentBindEventMap, componentMap, isVertical } = useFormContext();
const formRenderProps = injectRenderFormProps();
const values = useFormValues();
const errors = useFieldError(fieldName);
const fieldComponentRef = useTemplateRef<HTMLInputElement>('fieldComponentRef');
const formApi = formRenderProps.form;
const compact = computed(() => formRenderProps.compact);
const isInValid = computed(() => errors.value?.length > 0);
const DEFAULT_NAME_MAX_LENGTH = 64;
const DEFAULT_INPUT_MAX_LENGTH = 128;
const DEFAULT_LINK_MAX_LENGTH = 255;
const DEFAULT_LONG_TEXT_MAX_LENGTH = 500;
const DEFAULT_NUMBER_MAX = 999_999_999;
const DEFAULT_NUMBER_MIN = 0;

const FieldComponent = computed(() => {
  const finalComponent = isString(component)
    ? componentMap.value[component]
    : component;
  if (!finalComponent) {
    // 组件未注册
    console.warn(`Component ${component} is not registered`);
  }
  return finalComponent;
});

const {
  dynamicComponentProps,
  dynamicRules,
  isDisabled,
  isIf,
  isRequired,
  isShow,
} = useDependencies(() => dependencies);

const labelStyle = computed(() => {
  return labelClass?.includes('w-') || isVertical.value
    ? {}
    : {
        width: `${labelWidth}px`,
      };
});

const currentRules = computed(() => {
  return dynamicRules.value || rules;
});

const visible = computed(() => {
  return !hide && isIf.value && isShow.value;
});

/** 根据当前可见性与生效规则计算必填标记，动态规则切换时同步更新星号。 */
const shouldRequired = computed(() => {
  if (!visible.value) {
    return false;
  }

  if (!currentRules.value) {
    return isRequired.value;
  }

  if (isRequired.value) {
    return true;
  }

  if (isString(currentRules.value)) {
    // 必填规则统一采用 required 或以 Required 结尾的名称，组合规则也要识别。
    return currentRules.value.split('|').some((rule) => {
      // 冒号后是校验参数，不参与规则名称判断；格式校验本身不表示必填。
      const [ruleName] = rule.split(':', 1);
      return ruleName === 'required' || ruleName?.endsWith('Required');
    });
  }

  let isOptional = currentRules?.value?.isOptional?.();

  // 默认值不取消必填约束，按内部规则判断是否显示星号。
  const typeName = currentRules?.value?._def?.typeName;
  if (typeName === 'ZodDefault') {
    const innerType = currentRules?.value?._def.innerType;
    if (innerType) {
      isOptional = innerType.isOptional?.();
    }
  }

  return !isOptional;
});

const fieldRules = computed(() => {
  if (!visible.value) {
    return null;
  }

  let rules = currentRules.value;
  if (!rules) {
    return isRequired.value ? 'required' : null;
  }

  if (isString(rules)) {
    return rules;
  }

  const isOptional = !shouldRequired.value;
  if (!isOptional) {
    const unwrappedRules = (rules as any)?.unwrap?.();
    if (unwrappedRules) {
      rules = unwrappedRules;
    }
  }
  return toTypedSchema(rules as ZodType);
});

function hasOwnProp(props: Record<string, any>, key: string) {
  return Object.prototype.hasOwnProperty.call(props, key);
}

function isTextInputComponent() {
  return (
    isString(component) && ['Input', 'Textarea', 'VbenInput'].includes(component)
  );
}

function isNumberInputComponent(props: Record<string, any>) {
  return (
    (isString(component) && component === 'InputNumber') ||
    (isString(component) &&
      ['Input', 'VbenInput'].includes(component) &&
      props.type === 'number')
  );
}

function getDefaultTextMaxLength(props: Record<string, any>) {
  const fieldIdentity = `${fieldName} ${isString(label) ? label : ''}`.toLowerCase();
  const inputType = String(props.type || '').toLowerCase();

  if (
    inputType === 'textarea' ||
    component === 'Textarea' ||
    /description|remark|content|desc|memo|log|json|config|dsl|描述|说明|备注|内容|日志|规则/.test(
      fieldIdentity,
    )
  ) {
    return DEFAULT_LONG_TEXT_MAX_LENGTH;
  }

  if (
    /url|uri|path|link|redirect|callback|address|domain|host|endpoint|stream|file|image|avatar|地址|链接|路径|域名|图片|文件|回调|推流/.test(
      fieldIdentity,
    )
  ) {
    return DEFAULT_LINK_MAX_LENGTH;
  }

  if (/name|title|label|code|key|名称|标题|标签|编码|代码|关键字|关键词/.test(fieldIdentity)) {
    return DEFAULT_NAME_MAX_LENGTH;
  }

  return DEFAULT_INPUT_MAX_LENGTH;
}

function appendDefaultLimitProps(props: MaybeComponentProps = {}) {
  const finalProps: Record<string, any> = { ...props };

  if (isNumberInputComponent(finalProps)) {
    // 数字字段只在页面没有单独声明范围时补默认范围，避免覆盖百分比、置信度等业务限制。
    if (!hasOwnProp(finalProps, 'min')) {
      finalProps.min = DEFAULT_NUMBER_MIN;
    }
    if (!hasOwnProp(finalProps, 'max')) {
      finalProps.max = DEFAULT_NUMBER_MAX;
    }
    if (!hasOwnProp(finalProps, 'step')) {
      finalProps.step = 1;
    }
    return finalProps;
  }

  if (!isTextInputComponent()) {
    return finalProps;
  }

  // 文本字段默认补长度上限；已有 maxlength/maxLength 的页面配置优先。
  if (!hasOwnProp(finalProps, 'maxlength') && !hasOwnProp(finalProps, 'maxLength')) {
    finalProps.maxlength = getDefaultTextMaxLength(finalProps);
  }

  if (
    isString(component) &&
    ['Input', 'Textarea'].includes(component) &&
    (hasOwnProp(finalProps, 'maxlength') || hasOwnProp(finalProps, 'maxLength')) &&
    !hasOwnProp(finalProps, 'showWordLimit')
  ) {
    // 有长度上限的 Element Plus 文本框统一显示“当前字数/上限”，让限制在表单上可见。
    finalProps.showWordLimit = true;
  }

  return finalProps;
}

const computedProps = computed(() => {
  const finalComponentProps = isFunction(componentProps)
    ? componentProps(values.value, formApi!)
    : componentProps;

  const mergedProps = {
    ...commonComponentProps,
    ...finalComponentProps,
    ...dynamicComponentProps.value,
  };

  // 搜索区使用 compact 表单，只在新增/编辑等业务表单自动补充限制和字数计数。
  return compact.value ? mergedProps : appendDefaultLimitProps(mergedProps);
});

watch(
  () => computedProps.value?.autofocus,
  (value) => {
    if (value === true) {
      nextTick(() => {
        autofocus();
      });
    }
  },
  { immediate: true },
);

const shouldDisabled = computed(() => {
  return isDisabled.value || disabled || computedProps.value?.disabled;
});

const customContentRender = computed(() => {
  if (!isFunction(renderComponentContent)) {
    return {};
  }
  return renderComponentContent(values.value, formApi!);
});

const renderContentKey = computed(() => {
  return Object.keys(customContentRender.value);
});

const fieldProps = computed(() => {
  const rules = fieldRules.value;
  return {
    keepValue: true,
    label: isString(label) ? label : '',
    ...(rules ? { rules } : {}),
    ...(formFieldProps as Record<string, any>),
  };
});

function fieldBindEvent(slotProps: Record<string, any>) {
  const modelValue = slotProps.componentField.modelValue;
  const handler = slotProps.componentField['onUpdate:modelValue'];

  const bindEventField =
    modelPropName ||
    (isString(component) ? componentBindEventMap.value?.[component] : null);

  let value = modelValue;
  // antd design 的一些组件会传递一个 event 对象
  if (modelValue && isObject(modelValue) && bindEventField) {
    value = isEventObjectLike(modelValue)
      ? modelValue?.target?.[bindEventField]
      : (modelValue?.[bindEventField] ?? modelValue);
  }

  if (bindEventField) {
    return {
      [`onUpdate:${bindEventField}`]: handler,
      [bindEventField]: value === undefined ? emptyStateValue : value,
      onChange: disabledOnChangeListener
        ? undefined
        : (e: Record<string, any>) => {
            const shouldUnwrap = isEventObjectLike(e);
            const onChange = slotProps?.componentField?.onChange;
            if (!shouldUnwrap) {
              return onChange?.(e);
            }

            return onChange?.(e?.target?.[bindEventField] ?? e);
          },
      ...(disabledOnInputListener ? { onInput: undefined } : {}),
    };
  }
  return {
    ...(disabledOnInputListener ? { onInput: undefined } : {}),
    ...(disabledOnChangeListener ? { onChange: undefined } : {}),
  };
}

function createComponentProps(slotProps: Record<string, any>) {
  const bindEvents = fieldBindEvent(slotProps);

  const binds = {
    ...slotProps.componentField,
    ...computedProps.value,
    ...bindEvents,
    ...(Reflect.has(computedProps.value, 'onChange')
      ? { onChange: computedProps.value.onChange }
      : {}),
    ...(Reflect.has(computedProps.value, 'onInput')
      ? { onInput: computedProps.value.onInput }
      : {}),
  };

  return binds;
}

function autofocus() {
  if (
    fieldComponentRef.value &&
    isFunction(fieldComponentRef.value.focus) &&
    // 检查当前是否有元素被聚焦
    document.activeElement !== fieldComponentRef.value
  ) {
    fieldComponentRef.value?.focus?.();
  }
}
const componentRefMap = injectComponentRefMap();
watch(fieldComponentRef, (componentRef) => {
  componentRefMap?.set(fieldName, componentRef);
});
onUnmounted(() => {
  if (componentRefMap?.has(fieldName)) {
    componentRefMap.delete(fieldName);
  }
});
</script>

<template>
  <FormField
    v-if="!hide && isIf"
    v-bind="fieldProps"
    v-slot="slotProps"
    :name="fieldName"
  >
    <FormItem
      v-show="isShow"
      :class="{
        'form-valid-error': isInValid,
        'form-is-required': shouldRequired,
        'flex-col': isVertical,
        'flex-row items-center': !isVertical,
        'pb-4': !compact,
        'pb-2': compact,
      }"
      class="relative flex"
      v-bind="$attrs"
    >
      <FormLabel
        v-if="!hideLabel"
        :class="
          cn(
            'flex leading-6',
            {
              'mr-2 flex-shrink-0 justify-end': !isVertical,
              'mb-1 flex-row': isVertical,
            },
            labelClass,
          )
        "
        :help="help"
        :colon="colon"
        :label="label"
        :required="shouldRequired && !hideRequiredMark"
        :style="labelStyle"
      >
        <template v-if="label">
          <VbenRenderContent :content="label" />
        </template>
      </FormLabel>
      <div class="flex-auto overflow-hidden p-[1px]">
        <div :class="cn('relative flex w-full items-center', wrapperClass)">
          <FormControl :class="cn(controlClass)">
            <slot
              v-bind="{
                ...slotProps,
                ...createComponentProps(slotProps),
                disabled: shouldDisabled,
                isInValid,
              }"
            >
              <component
                :is="FieldComponent"
                ref="fieldComponentRef"
                :class="{
                  'border-destructive hover:border-destructive/80 focus:border-destructive focus:shadow-[0_0_0_2px_rgba(255,38,5,0.06)]':
                    isInValid,
                }"
                v-bind="createComponentProps(slotProps)"
                :disabled="shouldDisabled"
              >
                <template
                  v-for="name in renderContentKey"
                  :key="name"
                  #[name]="renderSlotProps"
                >
                  <VbenRenderContent
                    :content="customContentRender[name]"
                    v-bind="{ ...renderSlotProps, formContext: slotProps }"
                  />
                </template>
                <!-- <slot></slot> -->
              </component>
              <VbenTooltip
                v-if="compact && isInValid"
                :delay-duration="300"
                side="left"
              >
                <template #trigger>
                  <slot name="trigger">
                    <CircleAlert
                      :class="
                        cn(
                          'inline-flex size-5 cursor-pointer text-foreground/80 hover:text-foreground',
                        )
                      "
                    />
                  </slot>
                </template>
                <FormMessage />
              </VbenTooltip>
            </slot>
          </FormControl>
          <!-- 自定义后缀 -->
          <div v-if="suffix" class="ml-1">
            <VbenRenderContent :content="suffix" />
          </div>
          <FormDescription v-if="description" class="ml-1">
            <VbenRenderContent :content="description" />
          </FormDescription>
        </div>

        <Transition name="slide-up" v-if="!compact">
          <FormMessage class="w-full whitespace-normal break-words" />
        </Transition>
      </div>
    </FormItem>
  </FormField>
</template>

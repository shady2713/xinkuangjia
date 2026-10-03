<script setup lang="ts">
/**
 * 单个表单项的渲染实现：按 schema 决定标签、说明与控件，
 * 并把校验规则、联动参数和控件引用收敛到同一个字段上下文里。
 * 卸载时必须释放控件引用与字段监听，否则表单销毁后仍有回调写回已失效的 DOM。
 */
import type { FieldSlotProps } from 'vee-validate';
import type { ZodType } from 'zod';

import type { Recordable } from '@vben-core/typings';

import type {
  FormComponentProps,
  FormRenderProps,
  FormSchema,
  MaybeComponentProps,
} from '../types';

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

/** 表单项的外部入参：直接复用 schema 定义，避免两处声明漂移。 */
type Props = FormSchema;

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
    commonComponentProps: FormComponentProps;
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

const fieldRules = computed(
  /**
   * 解析出真正交给 vee-validate 的校验规则。
   * 字段不可见时不注册任何规则：隐藏字段的旧错误会让提交永远无法通过。
   * @returns vee-validate 规则；字段不需要校验时为 null。
   */
  () => {
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
      // zod 规则的 unwrap 只在 ZodDefault/ZodOptional 等包装类型上存在，按需探测。
      const unwrap = (rules as ZodSchemaWithUnwrap).unwrap;
      const unwrappedRules = isFunction(unwrap)
        ? unwrap.call(rules)
        : undefined;
      if (unwrappedRules) {
        rules = unwrappedRules;
      }
    }
    return toTypedSchema(rules as ZodType);
  },
);

/**
 * 可能带包装层的 zod 规则。
 * `unwrap` 只在 ZodDefault、ZodOptional 等包装类型上存在，基础类型上没有该方法，
 * 因此按可选成员声明，调用前先探测。
 */
type ZodSchemaWithUnwrap = {
  /** 解开外层包装得到真实规则；基础类型上没有该方法。 */
  unwrap?: () => ZodType;
} & ZodType;

/** 判断参数对象是否自有某个键，避免把原型链上的键误判为页面已声明。 */
function hasOwnProp(props: MaybeComponentProps, key: string) {
  return Object.prototype.hasOwnProperty.call(props, key);
}

/** 判断当前控件是否接收文本输入，决定是否补默认长度限制。 */
function isTextInputComponent() {
  return (
    isString(component) &&
    ['Input', 'Textarea', 'VbenInput'].includes(component)
  );
}

/**
 * 判断控件最终是否按数字录入。
 * InputNumber 直接是数字；文本框需靠 `type="number"` 才按数字处理。
 * @param props 本次渲染合并出的控件属性。
 * @returns 控件按数字录入时为 true。
 */
function isNumberInputComponent(props: MaybeComponentProps) {
  return (
    (isString(component) && component === 'InputNumber') ||
    (isString(component) &&
      ['Input', 'VbenInput'].includes(component) &&
      props.type === 'number')
  );
}

/**
 * 按字段语义推断默认长度上限。
 * 字段的用途（长文本、链接、名称）比控件类型更能说明需要多长的输入，
 * 因此这里同时看字段名与标签，取最贴近业务语义的一档。
 * @param props 本次渲染合并出的控件属性。
 * @returns 该字段适用的默认最大长度。
 */
function getDefaultTextMaxLength(props: MaybeComponentProps) {
  const fieldIdentity =
    `${fieldName} ${isString(label) ? label : ''}`.toLowerCase();
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

  if (
    /name|title|label|code|key|名称|标题|标签|编码|代码|关键字|关键词/.test(
      fieldIdentity,
    )
  ) {
    return DEFAULT_NAME_MAX_LENGTH;
  }

  return DEFAULT_INPUT_MAX_LENGTH;
}

/**
 * 为控件补齐未被页面声明的默认限制。
 * 页面显式声明的 min/max/step/maxlength 一律优先，这里只补缺失项，
 * 避免默认值反向覆盖业务已经写明的取值范围。
 * @param props 页面声明的控件属性。
 * @returns 补齐默认限制后的新属性对象，不修改入参。
 */
function appendDefaultLimitProps(props: MaybeComponentProps = {}) {
  const finalProps: Recordable<unknown> = { ...props };

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
  if (
    !hasOwnProp(finalProps, 'maxlength') &&
    !hasOwnProp(finalProps, 'maxLength')
  ) {
    finalProps.maxlength = getDefaultTextMaxLength(finalProps);
  }

  if (
    isString(component) &&
    ['Input', 'Textarea'].includes(component) &&
    (hasOwnProp(finalProps, 'maxlength') ||
      hasOwnProp(finalProps, 'maxLength')) &&
    !hasOwnProp(finalProps, 'showWordLimit')
  ) {
    // 有长度上限的 Element Plus 文本框统一显示“当前字数/上限”，让限制在表单上可见。
    finalProps.showWordLimit = true;
  }

  return finalProps;
}

/**
 * 解析控件最终接收的属性。
 * 动态参数函数必须拿到表单上下文才能计算；上下文缺失时退化为空属性，
 * 而不是把 undefined 当成表单实例传进回调，让它在渲染期崩溃。
 * @param source schema 上声明的控件参数，可能是静态对象或按表单值计算的函数。
 * @param actions 当前表单上下文，缺省表示本表单项还没拿到表单实例。
 * @returns 可直接展开到控件上的属性对象。
 */
function resolveComponentProps(
  source: FormComponentProps | undefined,
  actions: FormRenderProps['form'],
): MaybeComponentProps {
  if (!isFunction(source)) {
    return source ?? {};
  }
  if (!actions) {
    return {};
  }
  return source(values.value, actions);
}

const computedProps = computed(
  /**
   * 合并控件最终接收的属性。
   * 顺序即优先级：公共配置 < 表单项配置 < 联动动态参数，再由字段绑定补上事件与取值。
   * @returns 传给 vee-validate Field 的属性集合。
   */
  () => {
    const finalComponentProps = resolveComponentProps(componentProps, formApi);

    const mergedProps = {
      ...commonComponentProps,
      ...finalComponentProps,
      ...dynamicComponentProps.value,
    };

    // 搜索区使用 compact 表单，只在新增/编辑等业务表单自动补充限制和字数计数。
    return compact.value ? mergedProps : appendDefaultLimitProps(mergedProps);
  },
);

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

const customContentRender = computed(
  /**
   * 按当前表单值计算控件的命名插槽内容。
   * 渲染函数缺失或表单项尚未拿到表单上下文时返回空对象，让控件退回默认渲染。
   * @returns 字段名到渲染函数的映射。
   */
  () => {
    if (!isFunction(renderComponentContent) || !formApi) {
      return {};
    }
    return renderComponentContent(values.value, formApi);
  },
);

const renderContentKey = computed(() => {
  return Object.keys(customContentRender.value);
});

/**
 * Field 组件只接受字符串 label：按优先顺序取第一个字符串候选。
 * ref 与函数形态的标签不在本组件的渲染能力范围内，直接跳过而不是把对象交给 Field。
 * @param candidates 依次尝试的标签候选，后者优先级更低。
 * @returns 命中的字符串标签；全部不是字符串时返回空串。
 */
function resolveFieldLabel(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (isString(candidate)) {
      return candidate;
    }
  }
  return '';
}

const fieldProps = computed(
  /**
   * 交给 vee-validate Field 的最终属性。
   * 显式声明的字段属性排在默认规则之后，因此页面配置可以覆盖推导出的默认值。
   * @returns Field 组件的属性集合，其中 label 已收敛为字符串。
   */
  () => {
    const rules = fieldRules.value;
    const declared = formFieldProps ?? {};
    return {
      keepValue: true,
      ...(rules ? { rules } : {}),
      ...declared,
      label: resolveFieldLabel(declared.label, label),
    };
  },
);

/**
 * 生成字段的 model 事件绑定。
 * @param slotProps vee-validate Field 提供的插槽参数。
 * @returns 透传给控件的事件与值映射。
 */
function fieldBindEvent(slotProps: FieldSlotProps<unknown>) {
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
        : /**
           * 转发 change 事件，并把事件对象还原为控件真实取值。
           * 部分 UI 库把事件对象当作值回传，直接透传会让表单收到 `{ target: ... }`。
           * @param e 控件抛出的 change 事件参数。
           * @returns 交给 vee-validate 字段回调的处理结果。
           */
          (e: Recordable<unknown>) => {
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

/**
 * 合并控件最终接收的属性：字段绑定、表单项配置与联动参数。
 * @param slotProps vee-validate Field 提供的插槽参数。
 * @returns 透传给实际控件的属性集合。
 */
function createComponentProps(slotProps: FieldSlotProps<unknown>) {
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

<script setup lang="ts">
/**
 * 表单渲染容器：按 schema 生成字段列表，并把公共配置下沉到每个字段。
 * 由 use-form-renderer 与 schema-form 挂载，
 * 负责折叠行计算与提交事件转发；不创建实例，不发请求。
 */
import type { GenericObject } from 'vee-validate';
import type { ZodTypeAny } from 'zod';

import type {
  FormCommonConfig,
  FormComponentProps,
  FormFieldOptions,
  FormRenderProps,
  FormSchema,
  FormShape,
  FormValues,
} from '../types';

import { computed, useTemplateRef } from 'vue';

import { Form } from '@vben-core/shadcn-ui';
import {
  cn,
  isFunction,
  isString,
  mergeWithArrayOverride,
} from '@vben-core/shared/utils';

import { provideFormRenderProps } from './context';
import { useExpandable } from './expandable';
import FormField from './form-field.vue';
import { getBaseRules, getDefaultValueInZodStack } from './helper';

/** 表单容器的外部入参：直接复用渲染属性定义，避免两处声明漂移。 */
type Props = FormRenderProps;

const props = withDefaults(
  defineProps<Props & { globalCommonConfig?: FormCommonConfig }>(),
  {
    collapsedRows: 1,
    /** 公共配置的默认值：给空对象而不是 undefined，下沉时无需再判空。 */
    commonConfig: () => ({}),
    /** 全局公共配置的默认值，由适配层启动时改写，这里先给空对象。 */
    globalCommonConfig: () => ({}),
    showCollapseButton: false,
    wrapperClass: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
  },
);

const emits = defineEmits<{
  submit: [event: FormValues];
}>();

/**
 * 表单容器的布局类名：按布局选择横向换行或纵向栅格，
 * 紧凑模式收窄列间距，页面自定义的栅格类名拼在最后覆盖默认值。
 */
const wrapperClass = computed(() => {
  const cls = ['flex'];
  if (props.layout === 'inline') {
    cls.push('flex-wrap gap-x-2');
  } else {
    cls.push(props.compact ? 'gap-x-2' : 'gap-x-4', 'flex-col grid');
  }
  return cn(...cls, props.wrapperClass);
});

provideFormRenderProps(props);

// 模板只负责提供 ref="wrapperRef" 绑定，真实消费方是展开计算：
// 在脚本侧取一次引用再交给 useExpandable，绑定关系才不会被当成无人使用的悬空 ref。
const wrapperRef = useTemplateRef<HTMLElement>('wrapperRef');
const { isCalculated, keepFormItemIndex } = useExpandable(props, wrapperRef);

/**
 * 把 schema 折算成业务插槽需要的字段形状列表。
 * 必填与否按 zod 规则的外层类型判断，ZodNullable/ZodOptional 不算必填。
 */
const shapes = computed(() => {
  const resultShapes: FormShape[] = [];
  props.schema?.forEach((schema) => {
    const { fieldName } = schema;
    const rules = schema.rules as ZodTypeAny;

    let typeName = '';
    if (rules && !isString(rules)) {
      typeName = rules._def.typeName;
    }

    const baseRules = getBaseRules(rules) as ZodTypeAny;

    resultShapes.push({
      default: getDefaultValueInZodStack(rules),
      fieldName,
      required: !['ZodNullable', 'ZodOptional'].includes(typeName),
      rules: baseRules,
    });
  });
  return resultShapes;
});

/** 真实 vee-validate 表单存在时用原生 form 元素，否则退回到 shadcn-ui 的无校验容器。 */
const formComponent = computed(() => (props.form ? 'form' : Form));

/** 容器组件的提交事件绑定：有 vee-validate 上下文时先由它做校验再向外抛值，否则直接抛值。 */
const formComponentProps = computed(() => {
  return props.form
    ? {
        /** 通过 vee-validate 校验后才向外抛出提交值。 */
        onSubmit: props.form.handleSubmit((val) => emits('submit', val)),
      }
    : {
        /** 无 vee-validate 上下文，原始值直接向外抛出。 */
        onSubmit: (val: GenericObject) => emits('submit', val),
      };
});

/**
 * 真正生效的折叠状态：需要页面开启折叠开关且行数已测量完成，否则一律视为展开，
 * 避免首帧测量未完成时先把后半部分字段藏起来。
 */
const formCollapsed = computed(() => {
  return props.collapsed && isCalculated.value;
});

/**
 * 逐项下沉公共配置后的表单项列表，同时按折叠状态决定哪些项加 hidden 类名。
 * 函数形式的 formItemClass 在这里求值，求值抛错只打印错误并退化为空串，不中断整表渲染。
 */
const computedSchema = computed(
  /**
   * 把全局表单配置下沉到每个表单项。
   * 表单项自己的配置排在全局配置之后，因此单个字段可以覆盖全局默认值。
   * @returns 合并公共配置后的表单项列表。
   */
  (): (Omit<FormSchema, 'formFieldProps'> & {
    commonComponentProps: FormComponentProps;
    formFieldProps: FormFieldOptions;
  })[] => {
    const {
      colon = false,
      componentProps = {},
      controlClass = '',
      disabled,
      disabledOnChangeListener = true,
      disabledOnInputListener = true,
      emptyStateValue = undefined,
      formFieldProps = {},
      formItemClass = '',
      hideLabel = false,
      hideRequiredMark = false,
      labelClass = '',
      labelWidth = 100,
      modelPropName = '',
      wrapperClass = '',
    } = mergeWithArrayOverride(props.commonConfig, props.globalCommonConfig);
    return (props.schema || []).map((schema, index) => {
      const keepIndex = keepFormItemIndex.value;

      const hidden =
        // 折叠状态 & 显示折叠按钮 & 当前索引大于保留索引
        props.showCollapseButton && !!formCollapsed.value && keepIndex
          ? keepIndex <= index
          : false;

      // 处理函数形式的formItemClass
      let resolvedSchemaFormItemClass = schema.formItemClass;
      if (isFunction(schema.formItemClass)) {
        try {
          resolvedSchemaFormItemClass = schema.formItemClass();
        } catch (error) {
          console.error('Error calling formItemClass function:', error);
          resolvedSchemaFormItemClass = '';
        }
      }

      return {
        colon,
        disabled,
        disabledOnChangeListener,
        disabledOnInputListener,
        emptyStateValue,
        hideLabel,
        hideRequiredMark,
        labelWidth,
        modelPropName,
        wrapperClass,
        ...schema,
        commonComponentProps: componentProps,
        componentProps: schema.componentProps,
        controlClass: cn(controlClass, schema.controlClass),
        formFieldProps: {
          ...formFieldProps,
          ...schema.formFieldProps,
        },
        formItemClass: cn(
          'flex-shrink-0',
          { hidden },
          formItemClass,
          resolvedSchemaFormItemClass,
        ),
        labelClass: cn(labelClass, schema.labelClass),
      };
    });
  },
);
</script>

<template>
  <component :is="formComponent" v-bind="formComponentProps">
    <div ref="wrapperRef" :class="wrapperClass">
      <template v-for="cSchema in computedSchema" :key="cSchema.fieldName">
        <!-- <div v-if="$slots[cSchema.fieldName]" :class="cSchema.formItemClass">
          <slot :definition="cSchema" :name="cSchema.fieldName"> </slot>
        </div> -->
        <FormField
          v-bind="cSchema"
          :class="cSchema.formItemClass"
          :rules="cSchema.rules"
        >
          <template #default="slotProps">
            <slot v-bind="slotProps" :name="cSchema.fieldName"> </slot>
          </template>
        </FormField>
      </template>
      <slot :shapes="shapes"></slot>
    </div>
  </component>
</template>

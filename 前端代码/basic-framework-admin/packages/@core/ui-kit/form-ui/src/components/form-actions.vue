<script setup lang="ts">
/**
 * 表单操作栏：渲染重置与提交按钮、折叠开关，并触发对应回调。
 * 提交先经实例校验，通过后才把值交给 handleSubmit；
 * 业务未提供 handleReset 时退回表单自身重置。不渲染任何字段。
 */
import { computed, toRaw, unref, watch } from 'vue';

import { useSimpleLocale } from '@vben-core/composables';
import { VbenExpandableArrow } from '@vben-core/shadcn-ui';
import { cn, isFunction, triggerWindowResize } from '@vben-core/shared/utils';

import { COMPONENT_MAP } from '../config';
import { injectFormProps } from '../use-form-context';

const { $t } = useSimpleLocale();

const [rootProps, form] = injectFormProps();

const collapsed = defineModel({ default: false });

/** 重置按钮的最终参数：默认显示并用当前语言文案，页面配置可以改文案或整体隐藏。 */
const resetButtonOptions = computed(() => {
  return {
    content: `${$t.value('reset')}`,
    show: true,
    ...unref(rootProps).resetButtonOptions,
  };
});

/** 提交按钮的最终参数：同样默认显示并本地化，业务传 show=false 即可只保留重置按钮。 */
const submitButtonOptions = computed(() => {
  return {
    content: `${$t.value('submit')}`,
    show: true,
    ...unref(rootProps).submitButtonOptions,
  };
});

// const isQueryForm = computed(() => {
//   return !!unref(rootProps).showCollapseButton;
// });

/**
 * 点击提交：先走实例校验，只有全部字段通过才把值交给业务的 handleSubmit。
 * 校验不通过时到此为止，不会调用业务回调，错误提示与滚动定位由校验过程自行完成。
 * @param e 按钮点击事件，用于阻止表单默认提交与事件冒泡。
 */
async function handleSubmit(e: Event) {
  e?.preventDefault();
  e?.stopPropagation();
  const props = unref(rootProps);
  if (!props.formApi) {
    return;
  }

  const { valid } = await props.formApi.validate();
  if (!valid) {
    return;
  }

  const values = toRaw(await props.formApi.getValues()) ?? {};
  await props.handleSubmit?.(values);
}

/**
 * 点击重置：优先交由业务的 handleReset 处理，没有提供时退回表单自身的 resetForm。
 * 无论走哪条分支，都会先把重置前的值取出来交给业务。
 */
async function handleReset(e: Event) {
  e?.preventDefault();
  e?.stopPropagation();
  const props = unref(rootProps);

  const values = toRaw(await props.formApi?.getValues()) ?? {};

  if (isFunction(props.handleReset)) {
    await props.handleReset?.(values);
  } else {
    form.resetForm();
  }
}

watch(
  () => collapsed.value,
  () => {
    const props = unref(rootProps);
    if (props.collapseTriggerResize) {
      triggerWindowResize();
    }
  },
);

/**
 * 操作区的布局类名：由 actionLayout 决定是否独占一行、由 actionPosition 决定对齐方式，
 * 并按表单布局与紧凑模式补齐底部留白与对齐，页面自定义类名始终拼在最后。
 */
const actionWrapperClass = computed(() => {
  const props = unref(rootProps);
  const actionLayout = props.actionLayout || 'rowEnd';
  const actionPosition = props.actionPosition || 'right';

  const cls = [
    'flex',
    'items-center',
    'gap-3',
    props.compact ? 'pb-2' : 'pb-4',
    props.layout === 'vertical' ? 'self-end' : 'self-center',
    props.layout === 'inline' ? '' : 'w-full',
    props.actionWrapperClass,
  ];

  switch (actionLayout) {
    case 'newLine': {
      cls.push('col-span-full');
      break;
    }
    case 'rowEnd': {
      cls.push('col-[-2/-1]');
      break;
    }
    // 'inline' 不需要额外类名，保持默认
  }

  switch (actionPosition) {
    case 'center': {
      cls.push('justify-center');
      break;
    }
    case 'left': {
      cls.push('justify-start');
      break;
    }
    default: {
      // case 'right': 默认右对齐
      cls.push('justify-end');
      break;
    }
  }

  return cls.join(' ');
});

defineExpose({
  handleReset,
  handleSubmit,
});
</script>
<template>
  <div :class="cn(actionWrapperClass)">
    <template v-if="rootProps.actionButtonsReverse">
      <!-- 提交按钮前 -->
      <slot name="submit-before"></slot>

      <component
        :is="COMPONENT_MAP.PrimaryButton"
        v-if="submitButtonOptions.show"
        type="button"
        @click="handleSubmit"
        v-bind="submitButtonOptions"
      >
        {{ submitButtonOptions.content }}
      </component>
    </template>

    <!-- 重置按钮前 -->
    <slot name="reset-before"></slot>

    <component
      :is="COMPONENT_MAP.DefaultButton"
      v-if="resetButtonOptions.show"
      type="button"
      @click="handleReset"
      v-bind="resetButtonOptions"
    >
      {{ resetButtonOptions.content }}
    </component>

    <template v-if="!rootProps.actionButtonsReverse">
      <!-- 提交按钮前 -->
      <slot name="submit-before"></slot>

      <component
        :is="COMPONENT_MAP.PrimaryButton"
        v-if="submitButtonOptions.show"
        type="button"
        @click="handleSubmit"
        v-bind="submitButtonOptions"
      >
        {{ submitButtonOptions.content }}
      </component>
    </template>

    <!-- 展开按钮前 -->
    <slot name="expand-before"></slot>

    <VbenExpandableArrow
      class="ml-[-0.3em]"
      v-if="rootProps.showCollapseButton"
      v-model:model-value="collapsed"
    >
      <span>{{ collapsed ? $t('expand') : $t('collapse') }}</span>
    </VbenExpandableArrow>

    <!-- 展开按钮后 -->
    <slot name="expand-after"></slot>
  </div>
</template>

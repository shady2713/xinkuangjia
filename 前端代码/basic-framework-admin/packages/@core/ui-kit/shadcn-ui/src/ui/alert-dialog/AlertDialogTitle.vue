<script setup lang="ts">
/**
 * 警告对话框标题：渲染 reka-ui 标题语义节点并统一加粗排版。
 * 只输出标题文本，说明文字与操作按钮由同级件各自承担。
 */
import type { AlertDialogTitleProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { AlertDialogTitle, useForwardProps } from 'reka-ui';

const props = defineProps<AlertDialogTitleProps & { class?: ClassValue }>();

/** 去掉 class 后的标题节点属性，转交 AlertDialogTitle；标题排版由模板类名负责，不进属性通道。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <AlertDialogTitle
    v-bind="forwardedProps"
    :class="
      cn('text-lg font-semibold leading-none tracking-tight', props.class)
    "
  >
    <slot></slot>
  </AlertDialogTitle>
</template>

<script setup lang="ts">
/**
 * 对话框标题：渲染加粗标题，并由 reka-ui 关联为面板的
 * aria-labelledby 标题节点；说明文本由 DialogDescription 提供。
 */
import type { DialogTitleProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DialogTitle, useForwardProps } from 'reka-ui';

const props = defineProps<DialogTitleProps & { class?: ClassValue }>();

/** 去掉 class 后的标题节点属性，转交 DialogTitle，由 reka-ui 登记为面板的 aria-labelledby 目标。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DialogTitle
    v-bind="forwardedProps"
    :class="
      cn('text-lg font-semibold leading-none tracking-tight', props.class)
    "
  >
    <slot></slot>
  </DialogTitle>
</template>

<script lang="ts" setup>
/**
 * 警告对话框说明文字：渲染 reka-ui 描述节点并套用弱化前景色。
 * 只承载补充文本与无障碍关联，标题、按钮与显隐由同级件负责。
 */
import type { AlertDialogDescriptionProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { AlertDialogDescription, useForwardProps } from 'reka-ui';

const props = defineProps<
  AlertDialogDescriptionProps & { class?: ClassValue }
>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <AlertDialogDescription
    v-bind="forwardedProps"
    :class="cn('text-sm text-muted-foreground', props.class)"
  >
    <slot></slot>
  </AlertDialogDescription>
</template>

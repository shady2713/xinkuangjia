<script setup lang="ts">
/**
 * 对话框说明文本：渲染弱化说明，并由 reka-ui 关联为面板的
 * aria-describedby 描述节点；标题语义由 DialogTitle 提供。
 */
import type { DialogDescriptionProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DialogDescription, useForwardProps } from 'reka-ui';

const props = defineProps<DialogDescriptionProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <DialogDescription
    v-bind="forwardedProps"
    :class="cn('text-sm text-muted-foreground', props.class)"
  >
    <slot></slot>
  </DialogDescription>
</template>

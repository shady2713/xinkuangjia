<script setup lang="ts">
/** 抽屉说明文本：为对话框补充可读描述，抽屉缺描述时会渲染空说明占位以保全无障碍语义。 */
import type { DialogDescriptionProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DialogDescription } from 'reka-ui';

const props = defineProps<DialogDescriptionProps & { class?: ClassValue }>();

/** 去掉 class 后的说明节点属性，转交 DialogDescription；抽屉缺描述时仍渲染以维持无障碍结构。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <DialogDescription
    :class="cn('text-sm text-muted-foreground', props.class)"
    v-bind="delegatedProps"
  >
    <slot></slot>
  </DialogDescription>
</template>

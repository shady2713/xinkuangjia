<script setup lang="ts">
/** 抽屉标题：为对话框提供无障碍标题语义，抽屉没有标题时会渲染空标题占位。 */
import type { DialogTitleProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DialogTitle } from 'reka-ui';

const props = defineProps<DialogTitleProps & { class?: ClassValue }>();

/** 去掉 class 后的标题节点属性，转交 DialogTitle，供 reka-ui 建立 aria-labelledby 关联。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <DialogTitle
    :class="cn('font-medium text-foreground', props.class)"
    v-bind="delegatedProps"
  >
    <slot></slot>
  </DialogTitle>
</template>

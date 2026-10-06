<script setup lang="ts">
/**
 * 选项分隔线：在面板内画一条浅色横线，用来区隔不同分组或常用项与其余选项。
 * 只承担视觉分隔，不含文字也不参与选中；分组语义请交给 SelectGroup 与 SelectLabel。
 */
import type { SelectSeparatorProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { SelectSeparator } from 'reka-ui';

const props = defineProps<SelectSeparatorProps & { class?: ClassValue }>();

/** 去掉 class 后的分隔线属性，转交 SelectSeparator 作为纯视觉分组节点，不参与选中。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <SelectSeparator
    v-bind="delegatedProps"
    :class="cn('-mx-1 my-1 h-px bg-muted', props.class)"
  />
</template>

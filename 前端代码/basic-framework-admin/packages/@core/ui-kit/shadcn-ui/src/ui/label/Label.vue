<script setup lang="ts">
/**
 * 标签原子组件：包装 reka-ui Label，统一字号字重与禁用态透明度。
 * 只处理样式与 class 合并，不感知具体表单字段；
 * 需与字段 id 关联的标签请改用 form 目录的 FormLabel。
 */
import type { LabelProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { Label } from 'reka-ui';

const props = defineProps<LabelProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <Label
    v-bind="delegatedProps"
    :class="
      cn(
        'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        props.class,
      )
    "
  >
    <slot></slot>
  </Label>
</template>

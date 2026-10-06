<script setup lang="ts">
/** 多行文本输入框：渲染可换行的文本域，并透传双向绑定值。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { useVModel } from '@vueuse/core';

const props = defineProps<{
  class?: ClassValue;
  defaultValue?: number | string;
  modelValue?: number | string;
}>();

const emits = defineEmits<{
  /**
   * 多行文本变更事件：useVModel 处于 passive 模式，每次触发都把新值同步给父组件。
   * @param e 事件名，固定为 update:modelValue。
   * @param payload 文本域当前的新值，未做去空白或长度截断，按用户输入原样传出。
   */
  (e: 'update:modelValue', payload: number | string): void;
}>();

const modelValue = useVModel(props, 'modelValue', emits, {
  defaultValue: props.defaultValue,
  passive: true,
});
</script>

<template>
  <textarea
    v-model="modelValue"
    :class="
      cn(
        'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  ></textarea>
</template>

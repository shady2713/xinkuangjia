<script setup lang="ts">
/**
 * 选择面板向上翻页按钮：列表上方仍有内容时出现，点击把可滚动区域上移一屏，默认画向上箭头。
 * 与 SelectScrollDownButton 对称，只提供按钮本体，是否显示由 reka-ui 依滚动位置判断。
 */
import type { SelectScrollUpButtonProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronUp } from 'lucide-vue-next';
import { SelectScrollUpButton, useForwardProps } from 'reka-ui';

const props = defineProps<SelectScrollUpButtonProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectScrollUpButton
    v-bind="forwardedProps"
    :class="
      cn('flex cursor-default items-center justify-center py-1', props.class)
    "
  >
    <slot>
      <ChevronUp class="h-4 w-4" />
    </slot>
  </SelectScrollUpButton>
</template>

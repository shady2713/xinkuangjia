<script setup lang="ts">
/** 下滚按钮：列表溢出时驱动面板向下滚动，默认使用下箭头图标。 */
import type { SelectScrollDownButtonProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ChevronDown } from 'lucide-vue-next';
import { SelectScrollDownButton, useForwardProps } from 'reka-ui';

const props = defineProps<
  SelectScrollDownButtonProps & { class?: ClassValue }
>();

/** 去掉 class 后的下翻按钮属性，转交 SelectScrollDownButton；是否出现由 reka-ui 依当前滚动位置控制。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <SelectScrollDownButton
    v-bind="forwardedProps"
    :class="
      cn('flex cursor-default items-center justify-center py-1', props.class)
    "
  >
    <slot>
      <ChevronDown class="h-4 w-4" />
    </slot>
  </SelectScrollDownButton>
</template>

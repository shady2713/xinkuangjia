<script setup lang="ts">
/** 右键菜单分组标题：纯展示文字并按 inset 缩进，不响应点击也不承载动作。 */
import type { ContextMenuLabelProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ContextMenuLabel } from 'reka-ui';

const props = defineProps<
  ContextMenuLabelProps & { class?: ClassValue; inset?: boolean }
>();

/** 去掉 class 后的分组标题属性，直接绑定到 ContextMenuLabel，让标题不进入键盘焦点序列。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <ContextMenuLabel
    v-bind="delegatedProps"
    :class="
      cn(
        'px-2 py-1.5 text-sm font-semibold text-foreground',
        inset && 'pl-8',
        props.class,
      )
    "
  >
    <slot></slot>
  </ContextMenuLabel>
</template>

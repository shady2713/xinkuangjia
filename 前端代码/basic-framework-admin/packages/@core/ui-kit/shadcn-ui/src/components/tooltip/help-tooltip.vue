<script setup lang="ts">
/**
 * 问号帮助提示：默认渲染一个问号图标，悬停时在右侧浮出说明内容。
 *
 * 说明文字走默认插槽，trigger 插槽可换成别的触发元素；固定 300ms 延迟与
 * 右侧方向，不承载点击、确认等业务动作。
 */
import { cn } from '@vben-core/shared/utils';

import { CircleHelp } from 'lucide-vue-next';

import Tooltip from './tooltip.vue';

defineOptions({
  inheritAttrs: false,
});

defineProps<{ triggerClass?: string }>();
</script>

<template>
  <Tooltip :delay-duration="300" side="right">
    <template #trigger>
      <slot name="trigger">
        <CircleHelp
          :class="
            cn(
              'inline-flex size-5 cursor-pointer text-foreground/80 hover:text-foreground',
              triggerClass,
            )
          "
        />
      </slot>
    </template>
    <slot></slot>
  </Tooltip>
</template>

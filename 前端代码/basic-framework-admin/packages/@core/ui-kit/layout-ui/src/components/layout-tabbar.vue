<script setup lang="ts">
/**
 * 布局标签栏容器：只按 height 占位并透出默认插槽。
 *
 * 标签页签的渲染与交互由消费方通过插槽提供，本组件不参与页签管理。
 */
import type { CSSProperties } from 'vue';

import { computed } from 'vue';

interface Props {
  /**
   * 高度
   */
  height: number;
}

const props = withDefaults(defineProps<Props>(), {});

const style = computed((): CSSProperties => {
  const { height } = props;
  return {
    height: `${height}px`,
  };
});
</script>

<template>
  <section
    :style="style"
    class="flex w-full border-b border-border bg-background transition-all"
  >
    <slot></slot>
  </section>
</template>

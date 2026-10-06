<script setup lang="ts">
/**
 * 布局标签栏容器：只按 height 占位并透出默认插槽。
 *
 * 标签页签的渲染与交互由消费方通过插槽提供，本组件不参与页签管理。
 */
import type { CSSProperties } from 'vue';

import { computed } from 'vue';

/** 标签栏容器的属性契约：height 是容器占位高度（像素），宽度与左偏移由外壳以 style 属性直接传入。 */
interface Props {
  /**
   * 高度
   */
  height: number;
}

const props = withDefaults(defineProps<Props>(), {});

/** 标签栏容器的内联样式只输出固定高度，不参与宽度与偏移计算，混合导航下的排版由外壳用 style 覆盖。 */
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

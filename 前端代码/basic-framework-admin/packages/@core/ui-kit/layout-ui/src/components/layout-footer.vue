<script setup lang="ts">
/**
 * 布局页脚：按 height 撑高，靠负外边距在 show 为假时让出自身高度。
 *
 * 只负责尺寸、定位与过渡，内容由默认插槽提供；是否启用由外壳决定。
 */
import type { CSSProperties } from 'vue';

import { computed } from 'vue';

interface Props {
  /**
   * 是否固定在底部
   */
  fixed?: boolean;
  height: number;
  /**
   * 是否显示
   * @default true
   */
  show?: boolean;
  width: string;
  zIndex: number;
}

const props = withDefaults(defineProps<Props>(), {
  show: true,
});

const style = computed((): CSSProperties => {
  const { fixed, height, show, width, zIndex } = props;
  return {
    height: `${height}px`,
    marginBottom: show ? '0' : `-${height}px`,
    position: fixed ? 'fixed' : 'static',
    width,
    zIndex,
  };
});
</script>

<template>
  <footer
    :style="style"
    class="bottom-0 w-full bg-background-deep transition-all duration-200"
  >
    <slot></slot>
  </footer>
</template>

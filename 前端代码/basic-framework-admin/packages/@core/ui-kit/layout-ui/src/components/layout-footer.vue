<script setup lang="ts">
/**
 * 布局页脚：按 height 撑高，靠负外边距在 show 为假时让出自身高度。
 *
 * 只负责尺寸、定位与过渡，内容由默认插槽提供；是否启用由外壳决定。
 */
import type { CSSProperties } from 'vue';

import { computed } from 'vue';

/**
 * 页脚的属性契约：height 是页脚撑出的固定高度（像素），fixed 决定用 fixed 还是 static 定位；
 * show 为假时改用等高的负下边距抵消自身占用的高度；width 与 zIndex 由外壳按主内容列宽度与基线层级传入。
 */
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

/**
 * 页脚的定位与尺寸样式：高度固定为 height；fixed 为真时用 fixed 定位配合容器上的 bottom-0 贴底，否则退回文档流；
 * show 为假时把 marginBottom 换成等高负值以让出高度；width 与 zIndex 直接采用外壳传入值。
 */
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

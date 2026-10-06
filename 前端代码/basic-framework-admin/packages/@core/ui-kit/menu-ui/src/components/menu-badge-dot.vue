<script setup lang="ts">
/**
 * 菜单徽标圆点：渲染带扩散动画的小圆点，颜色与尺寸由外部传入。
 *
 * 自身不判断是否显示，显隐与取值由菜单徽标组件决定。
 */
import type { CSSProperties } from 'vue';

interface Props {
  dotClass?: string;
  dotStyle?: CSSProperties;
}

withDefaults(defineProps<Props>(), {
  dotClass: '',
  dotStyle: () => ({}),
});
</script>
<template>
  <span class="relative mr-1 flex size-1.5">
    <span
      :class="dotClass"
      :style="dotStyle"
      class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
    >
    </span>
    <span
      :class="dotClass"
      :style="dotStyle"
      class="relative inline-flex size-1.5 rounded-full"
    ></span>
  </span>
</template>

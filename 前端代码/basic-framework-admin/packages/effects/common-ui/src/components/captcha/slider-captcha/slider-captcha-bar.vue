<script setup lang="ts">
/**
 * 滑块验证码的进度条：按父级推入的宽度渲染填充，
 * 复位时用过渡类平滑回零，并向父级暴露根元素。
 */
import type { CSSProperties } from 'vue';

import { computed, ref, useTemplateRef } from 'vue';

const props = defineProps<{
  barStyle: CSSProperties;
  toLeft: boolean;
}>();

const barRef = useTemplateRef<HTMLDivElement>('barRef');

const width = ref('0');

/** 进度条的最终样式：调用方传入的样式叠加当前宽度。 */
const style = computed(() => {
  const { barStyle } = props;
  return {
    ...barStyle,
    width: width.value,
  };
});

defineExpose({
  /** 返回进度条根元素；尚未挂载时为 null。 */
  getEl: () => {
    return barRef.value;
  },
  /** 设置进度条宽度，取值为形如 '120px' 的字符串。 */
  setWidth: (val: string) => {
    width.value = val;
  },
});
</script>

<template>
  <div
    ref="barRef"
    :class="toLeft && 'transition-width !w-0 duration-300'"
    :style="style"
    class="bg-success absolute h-full"
  ></div>
</template>

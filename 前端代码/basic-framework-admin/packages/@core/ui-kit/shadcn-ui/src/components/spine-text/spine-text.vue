<script lang="ts" setup>
/**
 * 流光文字：给默认插槽里的文字叠一层来回扫过的高光，只负责视觉表现。
 *
 * 文案与尺寸由使用方通过插槽和 class 传入，animationDuration 决定单次扫描秒数，
 * animationIterationCount 决定循环次数；不做排版，也不处理任何业务状态。
 */
import { computed } from 'vue';

const { animationDuration = 2, animationIterationCount = 'infinite' } =
  defineProps<{
    // 动画持续时间，单位秒
    animationDuration?: number;
    // 动画是否只执行一次
    animationIterationCount?: 'infinite' | number;
  }>();

const style = computed(() => {
  return {
    animation: `shine ${animationDuration}s linear ${animationIterationCount}`,
  };
});
</script>
<template>
  <div :style="style" class="vben-spine-text !bg-clip-text text-transparent">
    <slot></slot>
  </div>
</template>
<style>
.vben-spine-text {
  background:
    radial-gradient(circle at center, rgb(255 255 255 / 80%), #f000) -200% 50% /
      200% 100% no-repeat,
    #000;

  /* animation: shine 3s linear infinite; */
}

.dark .vben-spine-text {
  background:
    radial-gradient(circle at center, rgb(24 24 26 / 80%), transparent) -200%
      50% / 200% 100% no-repeat,
    #f4f4f4;
}

@keyframes shine {
  0% {
    background-position: 200% 0%;
  }

  100% {
    background-position: -200% 0%;
  }
}
</style>

<script lang="ts" setup>
/** 标签栏全屏按钮：点击翻转 screen 双向绑定值，图标随之切换。 */
import { Fullscreen, Minimize2 } from '@vben-core/icons';

const screen = defineModel<boolean>('screen');

/** 全屏按钮的点击处理：翻转 screen 双向绑定的布尔值，模板据此切换进入与退出全屏的图标。 */
function toggleScreen() {
  screen.value = !screen.value;
}
</script>

<template>
  <div
    class="flex-center h-full cursor-pointer border-l border-border px-2 text-lg font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
    @click="toggleScreen"
  >
    <Minimize2 v-if="screen" class="size-4" />
    <Fullscreen v-else class="size-4" />
  </div>
</template>

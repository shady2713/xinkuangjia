<script setup lang="ts">
/**
 * 侧边栏固定按钮：点击翻转 expandOnHover 双向值。
 *
 * 图标随该值在 Pin 与 PinOff 间切换，悬停展开由侧边栏实现。
 */
import { Pin, PinOff } from '@vben-core/icons';

const expandOnHover = defineModel<boolean>('expandOnHover');

/** 点击时翻转 expandOnHover 双向值，图标随之在 Pin 与 PinOff 间切换；悬停展开的具体行为由侧边栏监听该值实现。 */
function toggleFixed() {
  expandOnHover.value = !expandOnHover.value;
}
</script>

<template>
  <div
    class="flex-center absolute bottom-2 right-3 z-10 cursor-pointer rounded-sm bg-accent p-[5px] text-foreground/60 transition-all duration-300 hover:bg-accent-hover hover:text-foreground"
    @click="toggleFixed"
  >
    <PinOff v-if="!expandOnHover" class="size-3.5" />
    <Pin v-else class="size-3.5" />
  </div>
</template>

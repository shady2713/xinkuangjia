<script setup lang="ts">
/**
 * 侧边栏折叠按钮：点击翻转 collapsed 双向值，图标随折叠状态换向。
 *
 * 只发出状态变化，宽度与动画由侧边栏自行计算。
 */
import { ChevronsLeft, ChevronsRight } from '@vben-core/icons';

const collapsed = defineModel<boolean>('collapsed');

/** 点击时翻转 collapsed 双向值，模板据此切换图标方向；宽度收缩由侧边栏监听该值后自行计算。 */
function handleCollapsed() {
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <div
    class="flex-center absolute bottom-2 left-3 z-10 cursor-pointer rounded-sm bg-accent p-1 text-foreground/60 hover:bg-accent-hover hover:text-foreground"
    @click.stop="handleCollapsed"
  >
    <ChevronsRight v-if="collapsed" class="size-4" />
    <ChevronsLeft v-else class="size-4" />
  </div>
</template>

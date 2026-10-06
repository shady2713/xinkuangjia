<script setup lang="ts">
/**
 * 布局页头：按 height 定高，并让 logo 区按侧边栏宽度或移动端收窄。
 *
 * 隐藏时用负 marginTop 收起头部，导航与切换按钮由插槽注入。
 */
import type { CSSProperties } from 'vue';

import { computed, useSlots } from 'vue';

/**
 * 顶栏的属性契约：height 既是顶栏高度也是收起动画的位移量（像素），show 为假时用等高负 marginTop 上移收起；
 * fullWidth 表示非侧边类布局；isMobile 决定 logo 区用窄占位；width 与 zIndex 由外壳按主内容列宽度和层级传入；
 * theme 只作为 class 输出，不参与尺寸计算。
 */
interface Props {
  /**
   * 横屏
   */
  fullWidth: boolean;
  /**
   * 高度
   */
  height: number;
  /**
   * 是否移动端
   */
  isMobile: boolean;
  /**
   * 是否显示
   */
  show: boolean;
  /**
   * 侧边菜单宽度
   */
  sidebarWidth: number;
  /**
   * 主题
   */
  theme: string | undefined;
  /**
   * 宽度
   */
  width: string;
  /**
   * zIndex
   */
  zIndex: number;
}

const props = withDefaults(defineProps<Props>(), {});

const slots = useSlots();

/**
 * 顶栏的尺寸与位移样式：高度固定，show 为假时用等高负上边距整体上移实现收起；
 * 仅当顶栏可见且处于横屏（fullWidth）布局时才把 right 锁为 0，收起状态或让位侧边栏的布局不锁右边距。
 */
const style = computed((): CSSProperties => {
  const { fullWidth, height, show } = props;
  const right = !show || !fullWidth ? undefined : 0;

  return {
    height: `${height}px`,
    marginTop: show ? 0 : `-${height}px`,
    right,
  };
});

/** logo 槽位的最小宽度：桌面端与侧边栏同宽，使 logo 区左侧与侧边栏对齐；移动端固定为 40px 的窄占位。 */
const logoStyle = computed((): CSSProperties => {
  return {
    minWidth: `${props.isMobile ? 40 : props.sidebarWidth}px`,
  };
});
</script>

<template>
  <header
    :class="theme"
    :style="style"
    class="top-0 flex w-full flex-[0_0_auto] items-center border-b border-border bg-header pl-2 transition-[margin-top] duration-200"
  >
    <div v-if="slots.logo" :style="logoStyle">
      <slot name="logo"></slot>
    </div>

    <slot name="toggle-button"> </slot>

    <slot></slot>
  </header>
</template>

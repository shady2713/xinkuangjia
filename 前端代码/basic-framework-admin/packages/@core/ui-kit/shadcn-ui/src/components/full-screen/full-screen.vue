<script lang="ts" setup>
/**
 * 全屏切换按钮：点击调用 useFullscreen 切换全屏，并按状态换最大/最小化图标。
 * 应用顶栏使用；初始化时把 webkit、moz、ms 前缀的全屏元素一并纳入判断，
 * 不负责进入全屏后的布局适配，那由使用方决定。
 */
import { Maximize, Minimize } from '@vben-core/icons';

import { useFullscreen } from '@vueuse/core';

import { VbenIconButton } from '../button';

defineOptions({ name: 'FullScreen' });

/**
 * 厂商前缀的全屏元素：标准 fullscreenElement 之外的只读兼容入口。
 * 老浏览器只暴露这些属性，判断全屏状态时必须一并读取。
 */
interface PrefixedFullscreenDocument extends Document {
  /** Firefox 前缀的全屏元素。 */
  readonly mozFullScreenElement: Element | null;
  /** 旧版 WebKit 前缀的全屏元素。 */
  readonly msFullscreenElement: Element | null;
  /** 旧版 WebKit 前缀的全屏元素。 */
  readonly webkitFullscreenElement: Element | null;
}

const { isFullscreen, toggle } = useFullscreen();

// 重新检查全屏状态。
// 厂商前缀属性不在标准 DOM 类型里，这里显式声明只读兼容入口，而不是压制检查。
const prefixedDocument = document as PrefixedFullscreenDocument;

isFullscreen.value = !!(
  document.fullscreenElement ||
  prefixedDocument.webkitFullscreenElement ||
  prefixedDocument.mozFullScreenElement ||
  prefixedDocument.msFullscreenElement
);
</script>
<template>
  <VbenIconButton
    class="hover:animate-[shrink_0.3s_ease-in-out]"
    @click="toggle"
  >
    <Minimize v-if="isFullscreen" class="size-4 text-foreground" />
    <Maximize v-else class="size-4 text-foreground" />
  </VbenIconButton>
</template>

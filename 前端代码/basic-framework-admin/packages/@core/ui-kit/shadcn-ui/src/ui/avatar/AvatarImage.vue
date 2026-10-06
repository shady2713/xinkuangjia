<script setup lang="ts">
/**
 * 头像图片：铺满头像容器并等比裁剪，保留 reka-ui 的加载状态判定。
 * 只渲染 img 本体，失败降级与尺寸形状由 Avatar、Fallback 决定。
 */
import type { AvatarImageProps } from 'reka-ui';

import { AvatarImage } from 'reka-ui';

const props = defineProps<AvatarImageProps>();
</script>

<template>
  <AvatarImage v-bind="props" class="h-full w-full object-cover" />
</template>

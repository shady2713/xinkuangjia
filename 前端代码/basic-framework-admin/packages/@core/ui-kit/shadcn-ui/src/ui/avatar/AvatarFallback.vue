<script setup lang="ts">
/**
 * 头像占位内容：图片缺失或加载失败时展示的文字与图标降级。
 * 加载状态由 reka-ui 判定，不负责图片地址解析与上传。
 */
import type { AvatarFallbackProps } from 'reka-ui';

import { AvatarFallback } from 'reka-ui';

const props = defineProps<AvatarFallbackProps>();
</script>

<template>
  <AvatarFallback v-bind="props">
    <slot></slot>
  </AvatarFallback>
</template>

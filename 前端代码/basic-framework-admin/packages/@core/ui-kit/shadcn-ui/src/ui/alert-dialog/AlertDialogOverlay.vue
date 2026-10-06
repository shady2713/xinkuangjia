<script setup lang="ts">
/**
 * 警告对话框遮罩：铺满视口的半透明层，挂载期间锁定页面滚动。
 * 只负责遮挡与滚动锁，内容层与关闭逻辑由 Content 部件提供。
 */
import { useScrollLock } from '@vben-core/composables';

useScrollLock();
</script>
<template>
  <div class="z-popup inset-0 bg-overlay"></div>
</template>

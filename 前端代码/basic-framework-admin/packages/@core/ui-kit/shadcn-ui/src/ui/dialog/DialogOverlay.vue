<script setup lang="ts">
/**
 * 对话框遮罩层：铺满视口，挂载时锁住 body 滚动并补偿滚动条宽度，
 * 同时把所属弹窗 id 标到 data 属性上，供点击外部关闭的判断识别遮罩归属。
 * 该文件不经桶文件导出，仅由 DialogContent 内部渲染；
 * 滚动内容弹窗用的是 reka-ui 自带遮罩。
 */
import { inject } from 'vue';

import { useScrollLock } from '@vben-core/composables';

useScrollLock();
const id = inject('DISMISSABLE_MODAL_ID');
</script>
<template>
  <div :data-dismissable-modal="id" class="z-popup inset-0 bg-overlay"></div>
</template>

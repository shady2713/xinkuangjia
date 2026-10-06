<script setup lang="ts">
/**
 * 抽屉遮罩：铺满视口的半透明底层，同时锁定背景滚动，并打上抽屉标识供外部点击归属判定。
 * data-dismissable-drawer 由 popup-ui 抽屉读取，用来区分点击遮罩关闭与点击面板内部。
 */
import { inject } from 'vue';

import { useScrollLock } from '@vben-core/composables';

useScrollLock();
const id = inject('DISMISSABLE_DRAWER_ID');
</script>
<template>
  <div :data-dismissable-drawer="id" class="z-popup inset-0 bg-overlay"></div>
</template>

<script lang="ts" setup>
/**
 * 403 兜底页：权限路由遇到无权访问时挂载，只展示提示与返回入口。
 *
 * 权限判定与拦截由 access 装配与守卫完成，本组件不再判断；
 * 404 兜底由 fallback/not-found.vue 承担。
 */
import { Fallback } from '@vben/common-ui';

defineOptions({ name: 'Fallback403' });
</script>

<template>
  <Fallback status="403" />
</template>

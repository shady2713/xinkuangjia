<script lang="ts" setup>
/**
 * 404 兜底页：挂在根路由的万能匹配上，所有已登记路由未命中时渲染。
 *
 * 只负责提示展示，权限判断与拦截不在这里；
 * 无权限访问的 403 提示由同级 forbidden 页承担。
 */
import { Fallback } from '@vben/common-ui';

defineOptions({ name: 'Fallback404' });
</script>

<template>
  <Fallback status="404" />
</template>

<script lang="ts" setup>
/**
 * 内容区加载外壳：把 useContentSpinner 的路由加载态接到 VbenSpinner 上。
 * 只在 BasicLayout 打开过渡加载时挂进内容区浮层，请求级 loading 不归它管。
 */
import { VbenSpinner } from '@vben-core/shadcn-ui';

import { useContentSpinner } from './use-content-spinner';

defineOptions({ name: 'LayoutContentSpinner' });

const { spinning } = useContentSpinner();
</script>
<template>
  <VbenSpinner :spinning="spinning" />
</template>

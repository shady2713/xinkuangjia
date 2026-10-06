<script lang="ts" setup>
/**
 * 应用根组件：注入 Element Plus 设计令牌，并通过配置提供器把组件语言包
 * 下发给全部子组件，页面内容交由 RouterView 承载。
 * 不参与路由与权限判断，布局与菜单由框架布局组件负责。
 */
import { useElementPlusDesignTokens } from '@vben/hooks';

import { ElConfigProvider } from 'element-plus';

import { elementLocale } from '#/locales';

defineOptions({ name: 'App' });

useElementPlusDesignTokens();
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
    <RouterView />
  </ElConfigProvider>
</template>

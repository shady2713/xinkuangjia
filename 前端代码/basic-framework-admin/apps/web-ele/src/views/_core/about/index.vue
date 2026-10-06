<script lang="ts" setup>
/**
 * 关于页面：直接渲染公共 UI 库的 About 组件，自身不承载业务内容。
 *
 * 目前没有静态路由指向它，只作为可被后台菜单引用的页面组件存在；
 * 版本与版权信息由 @vben/common-ui 维护，不在此处配置。
 */
import { About } from '@vben/common-ui';

defineOptions({ name: 'About' });
</script>

<template>
  <About />
</template>

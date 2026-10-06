<script lang="ts" setup>
/**
 * 认证页布局：把偏好里的应用名与明暗 logo 注入 @vben/layouts 的认证外壳。
 * 登录、注册等页面作为子路由渲染在其内部，认证流程本身不在这里处理。
 */
import { computed } from 'vue';

import { AuthPageLayout } from '@vben/layouts';
import { preferences } from '@vben/preferences';

import { $t } from '#/locales';

/** 认证页展示的应用名称，跟随偏好设置变化。 */
const appName = computed(() => preferences.app.name);
/** 认证页亮色模式下使用的应用 logo。 */
const logo = computed(() => preferences.logo.source);
/** 认证页暗色模式下使用的应用 logo。 */
const logoDark = computed(() => preferences.logo.sourceDark);
</script>

<template>
  <AuthPageLayout
    :app-name="appName"
    :logo="logo"
    :logo-dark="logoDark"
    :page-description="$t('authentication.pageDesc')"
    :page-title="$t('authentication.pageTitle')"
  />
</template>

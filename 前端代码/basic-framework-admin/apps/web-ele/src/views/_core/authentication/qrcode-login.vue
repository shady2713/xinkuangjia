<script lang="ts" setup>
/**
 * 扫码登录页：把登录路径交给公共扫码组件，自身不处理二维码逻辑。
 *
 * 二维码生成、轮询与登录结果跳转由 @vben/common-ui 负责；
 * 当前未登记静态路由，只作为可被后台菜单引用的页面组件存在。
 */
import { AuthenticationQrCodeLogin } from '@vben/common-ui';
import { LOGIN_PATH } from '@vben/constants';

defineOptions({ name: 'QrCodeLogin' });
</script>

<template>
  <AuthenticationQrCodeLogin :login-path="LOGIN_PATH" />
</template>

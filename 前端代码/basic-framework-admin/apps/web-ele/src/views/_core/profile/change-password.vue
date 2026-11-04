<script setup lang="ts">
/** 首次登录或密码被重置后的强制修改密码页面。 */
import { Page } from '@vben/common-ui';

import { ElCard, ElMessage } from 'element-plus';

import { useAuthStore } from '#/store';

import ResetPwd from './modules/reset-pwd.vue';

const authStore = useAuthStore();

/**
 * 强制改密完成后的处理：解除拦截标志并注销旧令牌，要求使用新密码重新登录。
 */
async function handleSuccess() {
  authStore.clearPasswordChangeRequired();
  ElMessage.success('密码修改成功，请使用新密码重新登录');
  // 当前 access token 仍由旧密码签发，改密后主动注销，避免旧会话继续使用。
  await authStore.logout(false);
}
</script>

<template>
  <Page auto-content-height>
    <div class="mx-auto mt-8 w-full max-w-xl">
      <ElCard title="首次修改密码">
        <p class="mb-4 text-sm text-gray-500">
          当前账号使用初始密码或已被管理员重置，完成修改后才能使用其他功能。
        </p>
        <ResetPwd silent-success @success="handleSuccess" />
      </ElCard>
    </div>
  </Page>
</template>

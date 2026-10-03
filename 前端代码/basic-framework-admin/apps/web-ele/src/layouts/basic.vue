<script lang="ts" setup>
/** 管理平台布局；认证失效会完整退出并跳转登录，不保留旧页面登录弹层。 */
import { computed, watch } from 'vue';

import { useWatermark } from '@vben/hooks';
import { AntdProfileOutlined } from '@vben/icons';
import { BasicLayout, LockScreen, UserDropdown } from '@vben/layouts';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';

import { $t } from '#/locales';
import { router } from '#/router';
import { useAuthStore } from '#/store';

const userStore = useUserStore();
const authStore = useAuthStore();
const { destroyWatermark, updateWatermark } = useWatermark();

const menus = computed(() => [
  {
    handler: () => {
      router.push({ name: 'Profile' });
    },
    icon: AntdProfileOutlined,
    text: $t('ui.widgets.profile'),
  },
]);

const avatar = computed(() => {
  return userStore.userInfo?.avatar ?? preferences.app.defaultAvatar;
});

async function handleLogout() {
  await authStore.logout(false);
}

watch(
  () => ({
    enable: preferences.app.watermark,
    content: preferences.app.watermarkContent,
  }),
  async ({ enable, content }) => {
    if (enable) {
      await updateWatermark({
        content:
          content ||
          `${userStore.userInfo?.id} - ${userStore.userInfo?.nickname}`,
      });
    } else {
      destroyWatermark();
    }
  },
  {
    immediate: true,
  },
);
</script>

<template>
  <BasicLayout @clear-preferences-and-logout="handleLogout">
    <template #user-dropdown>
      <UserDropdown
        :avatar
        :menus
        :text="userStore.userInfo?.nickname"
        :description="userStore.userInfo?.email"
        :tag-text="userStore.userInfo?.username"
        @logout="handleLogout"
      />
    </template>
    <template #lock-screen>
      <LockScreen :avatar @to-login="handleLogout" />
    </template>
  </BasicLayout>
</template>

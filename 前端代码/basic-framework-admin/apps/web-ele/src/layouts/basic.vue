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

/** 用户下拉菜单项：只提供个人中心入口，点击后跳转到 Profile 路由。 */
const menus = computed(() => [
  {
    /** 跳转到个人中心页面。 */
    handler: () => {
      router.push({ name: 'Profile' });
    },
    icon: AntdProfileOutlined,
    text: $t('ui.widgets.profile'),
  },
]);

/** 用户头像：优先用用户信息的头像，未取得用户信息时回落到偏好设置的默认头像。 */
const avatar = computed(() => {
  return userStore.userInfo?.avatar ?? preferences.app.defaultAvatar;
});

/** 退出登录：清空登录态并交由框架跳转登录页，用户下拉菜单与锁屏都复用该处理函数。 */
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

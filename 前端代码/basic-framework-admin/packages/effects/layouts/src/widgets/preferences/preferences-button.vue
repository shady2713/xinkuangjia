<script lang="ts" setup>
/**
 * 偏好设置触发按钮：以齿轮图标唤起 preferences.vue 抽屉，并转发抽屉的退出事件。
 * 只做触发与事件透传，偏好项读写、语言包切换均由 preferences.vue 负责。
 */
import { Settings } from '@vben/icons';

import { VbenIconButton } from '@vben-core/shadcn-ui';

import Preferences from './preferences.vue';

const emit = defineEmits<{ clearPreferencesAndLogout: [] }>();

/** 把抽屉的退出事件原样抛给上层；本组件不执行偏好清理与登出。 */
function clearPreferencesAndLogout() {
  emit('clearPreferencesAndLogout');
}
</script>
<template>
  <Preferences @clear-preferences-and-logout="clearPreferencesAndLogout">
    <VbenIconButton class="hover:animate-[shrink_0.3s_ease-in-out]">
      <Settings class="text-foreground size-4" />
    </VbenIconButton>
  </Preferences>
</template>

<script setup lang="ts">
/**
 * 全局快捷键偏好分组：总开关及搜索、退出登录、锁屏三项的启停。
 * 按平台显示 Ctrl 或 ⌘、Alt 或 ⌥ 的按键提示，总开关关闭时各项置灰；
 * 按键的实际监听与触发不在这里。
 */
import { computed } from 'vue';

import { $t } from '@vben/locales';
import { isWindowsOs } from '@vben/utils';

import SwitchItem from '../switch-item.vue';

defineOptions({
  name: 'PreferenceGeneralConfig',
});

const shortcutKeysEnable = defineModel<boolean>('shortcutKeysEnable');
const shortcutKeysGlobalSearch = defineModel<boolean>(
  'shortcutKeysGlobalSearch',
);
const shortcutKeysLogout = defineModel<boolean>('shortcutKeysLogout');
const shortcutKeysLockScreen = defineModel<boolean>('shortcutKeysLockScreen');

const altView = computed(() => (isWindowsOs() ? 'Alt' : '⌥'));
</script>

<template>
  <SwitchItem v-model="shortcutKeysEnable">
    {{ $t('preferences.shortcutKeys.title') }}
  </SwitchItem>
  <SwitchItem
    v-model="shortcutKeysGlobalSearch"
    :disabled="!shortcutKeysEnable"
  >
    {{ $t('preferences.shortcutKeys.search') }}
    <template #shortcut>
      {{ isWindowsOs() ? 'Ctrl' : '⌘' }}
      <kbd> K </kbd>
    </template>
  </SwitchItem>
  <SwitchItem v-model="shortcutKeysLogout" :disabled="!shortcutKeysEnable">
    {{ $t('preferences.shortcutKeys.logout') }}
    <template #shortcut> {{ altView }} Q </template>
  </SwitchItem>
  <SwitchItem v-model="shortcutKeysLockScreen" :disabled="!shortcutKeysEnable">
    {{ $t('ui.widgets.lockScreen.title') }}
    <template #shortcut> {{ altView }} L </template>
  </SwitchItem>
</template>

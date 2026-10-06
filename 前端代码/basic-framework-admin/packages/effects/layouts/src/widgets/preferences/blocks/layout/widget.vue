<script setup lang="ts">
/**
 * 界面控件偏好分组：开关顶栏的搜索、主题、全屏、通知、锁屏、
 * 侧边栏折叠与刷新等图标，并选择偏好按钮的停靠位置。
 * 只声明图标是否出现，各控件的实际行为由对应组件实现。
 */
import type { SelectOption } from '@vben/types';

import { computed } from 'vue';

import { $t } from '@vben/locales';

import SelectItem from '../select-item.vue';
import SwitchItem from '../switch-item.vue';

defineOptions({
  name: 'PreferenceInterfaceControl',
});

const widgetGlobalSearch = defineModel<boolean>('widgetGlobalSearch');
const widgetFullscreen = defineModel<boolean>('widgetFullscreen');
const widgetNotification = defineModel<boolean>('widgetNotification');
const widgetThemeToggle = defineModel<boolean>('widgetThemeToggle');
const widgetSidebarToggle = defineModel<boolean>('widgetSidebarToggle');
const widgetLockScreen = defineModel<boolean>('widgetLockScreen');
const appPreferencesButtonPosition = defineModel<string>(
  'appPreferencesButtonPosition',
);
const widgetRefresh = defineModel<boolean>('widgetRefresh');

/** 偏好按钮停靠位置选项：自动、顶栏、固定三种，文案随当前语言变化。 */
const positionItems = computed((): SelectOption[] => [
  {
    label: $t('preferences.position.auto'),
    value: 'auto',
  },
  {
    label: $t('preferences.position.header'),
    value: 'header',
  },
  {
    label: $t('preferences.position.fixed'),
    value: 'fixed',
  },
]);
</script>

<template>
  <SwitchItem v-model="widgetGlobalSearch">
    {{ $t('preferences.widget.globalSearch') }}
  </SwitchItem>
  <SwitchItem v-model="widgetThemeToggle">
    {{ $t('preferences.widget.themeToggle') }}
  </SwitchItem>
  <SwitchItem v-model="widgetFullscreen">
    {{ $t('preferences.widget.fullscreen') }}
  </SwitchItem>
  <SwitchItem v-model="widgetNotification">
    {{ $t('preferences.widget.notification') }}
  </SwitchItem>
  <SwitchItem v-model="widgetLockScreen">
    {{ $t('preferences.widget.lockScreen') }}
  </SwitchItem>
  <SwitchItem v-model="widgetSidebarToggle">
    {{ $t('preferences.widget.sidebarToggle') }}
  </SwitchItem>
  <SwitchItem v-model="widgetRefresh">
    {{ $t('preferences.widget.refresh') }}
  </SwitchItem>
  <SelectItem v-model="appPreferencesButtonPosition" :items="positionItems">
    {{ $t('preferences.position.title') }}
  </SelectItem>
</template>

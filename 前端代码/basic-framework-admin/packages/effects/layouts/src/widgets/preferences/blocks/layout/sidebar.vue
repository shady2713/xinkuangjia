<script setup lang="ts">
/**
 * 侧边栏偏好分组：显隐、折叠、悬浮展开、折叠标题、底部按钮与宽度。
 * sidebarButtons 数组与折叠、固定两个布尔开关在此双向同步；
 * 宽度限定 160 到 320，侧边栏本身由布局容器渲染。
 */
import type { LayoutType } from '@vben/types';

import { watch } from 'vue';

import { $t } from '@vben/locales';

import CheckboxItem from '../checkbox-item.vue';
import NumberFieldItem from '../number-field-item.vue';
import SwitchItem from '../switch-item.vue';

defineProps<{ currentLayout?: LayoutType; disabled: boolean }>();

const sidebarEnable = defineModel<boolean>('sidebarEnable');
const sidebarWidth = defineModel<number>('sidebarWidth');
const sidebarCollapsedShowTitle = defineModel<boolean>(
  'sidebarCollapsedShowTitle',
);
const sidebarCollapsed = defineModel<boolean>('sidebarCollapsed');
const sidebarExpandOnHover = defineModel<boolean>('sidebarExpandOnHover');

const sidebarButtons = defineModel<string[]>('sidebarButtons', { default: [] });
const sidebarCollapsedButton = defineModel<boolean>('sidebarCollapsedButton');
const sidebarFixedButton = defineModel<boolean>('sidebarFixedButton');

watch(
  () => [sidebarCollapsedButton.value, sidebarFixedButton.value],
  ([collapsed, fixed]) => {
    const newButtons: string[] = [];
    if (collapsed) {
      newButtons.push('collapsed');
    }
    if (fixed) {
      newButtons.push('fixed');
    }

    const current = sidebarButtons.value || [];
    const isSame =
      current.length === newButtons.length &&
      current.every((item) => newButtons.includes(item));

    if (!isSame) {
      sidebarButtons.value = newButtons;
    }
  },
  { immediate: true },
);

const handleCheckboxChange = () => {
  sidebarCollapsedButton.value = !!sidebarButtons.value.includes('collapsed');
  sidebarFixedButton.value = !!sidebarButtons.value.includes('fixed');
};
</script>

<template>
  <SwitchItem v-model="sidebarEnable" :disabled="disabled">
    {{ $t('preferences.sidebar.visible') }}
  </SwitchItem>
  <SwitchItem v-model="sidebarCollapsed" :disabled="!sidebarEnable || disabled">
    {{ $t('preferences.sidebar.collapsed') }}
  </SwitchItem>
  <SwitchItem
    v-model="sidebarExpandOnHover"
    :disabled="!sidebarEnable || disabled || !sidebarCollapsed"
    :tip="$t('preferences.sidebar.expandOnHoverTip')"
  >
    {{ $t('preferences.sidebar.expandOnHover') }}
  </SwitchItem>
  <SwitchItem
    v-model="sidebarCollapsedShowTitle"
    :disabled="!sidebarEnable || disabled || !sidebarCollapsed"
  >
    {{ $t('preferences.sidebar.collapsedShowTitle') }}
  </SwitchItem>
  <CheckboxItem
    :items="[
      { label: $t('preferences.sidebar.buttonCollapsed'), value: 'collapsed' },
      { label: $t('preferences.sidebar.buttonFixed'), value: 'fixed' },
    ]"
    multiple
    v-model="sidebarButtons"
    :on-btn-click="handleCheckboxChange"
  >
    {{ $t('preferences.sidebar.buttons') }}
  </CheckboxItem>
  <NumberFieldItem
    v-model="sidebarWidth"
    :disabled="!sidebarEnable || disabled"
    :max="320"
    :min="160"
    :step="10"
  >
    {{ $t('preferences.sidebar.width') }}
  </NumberFieldItem>
</template>

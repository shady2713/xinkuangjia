<script setup lang="ts">
/**
 * 标签栏偏好分组：多标签的显隐、持久化、访问历史、拖拽与滚轮行为、
 * 中键关闭、图标、更多与最大化按钮、样式类型及数量上限。
 * 标签栏未启用时各项自动置灰，标签页的实际增删由标签栏容器实现。
 */
import type { SelectOption } from '@vben/types';

import { computed } from 'vue';

import { $t } from '@vben/locales';

import NumberFieldItem from '../number-field-item.vue';
import SelectItem from '../select-item.vue';
import SwitchItem from '../switch-item.vue';

defineOptions({
  name: 'PreferenceTabsConfig',
});

defineProps<{ disabled?: boolean }>();

const tabbarEnable = defineModel<boolean>('tabbarEnable');
const tabbarShowIcon = defineModel<boolean>('tabbarShowIcon');
const tabbarPersist = defineModel<boolean>('tabbarPersist');
const tabbarVisitHistory = defineModel<boolean>('tabbarVisitHistory');
const tabbarDraggable = defineModel<boolean>('tabbarDraggable');
const tabbarWheelable = defineModel<boolean>('tabbarWheelable');
const tabbarStyleType = defineModel<string>('tabbarStyleType');
const tabbarShowMore = defineModel<boolean>('tabbarShowMore');
const tabbarShowMaximize = defineModel<boolean>('tabbarShowMaximize');
const tabbarMaxCount = defineModel<number>('tabbarMaxCount');
const tabbarMiddleClickToClose = defineModel<boolean>(
  'tabbarMiddleClickToClose',
);

/** 标签栏样式选项：chrome、plain、card、brisk 四种，文案随当前语言变化。 */
const styleItems = computed((): SelectOption[] => [
  {
    label: $t('preferences.tabbar.styleType.chrome'),
    value: 'chrome',
  },
  {
    label: $t('preferences.tabbar.styleType.plain'),
    value: 'plain',
  },
  {
    label: $t('preferences.tabbar.styleType.card'),
    value: 'card',
  },

  {
    label: $t('preferences.tabbar.styleType.brisk'),
    value: 'brisk',
  },
]);
</script>

<template>
  <SwitchItem v-model="tabbarEnable" :disabled="disabled">
    {{ $t('preferences.tabbar.enable') }}
  </SwitchItem>
  <SwitchItem v-model="tabbarPersist" :disabled="!tabbarEnable">
    {{ $t('preferences.tabbar.persist') }}
  </SwitchItem>
  <SwitchItem
    v-model="tabbarVisitHistory"
    :disabled="!tabbarEnable"
    :tip="$t('preferences.tabbar.visitHistoryTip')"
  >
    {{ $t('preferences.tabbar.visitHistory') }}
  </SwitchItem>
  <NumberFieldItem
    v-model="tabbarMaxCount"
    :disabled="!tabbarEnable"
    :max="30"
    :min="0"
    :step="5"
    :tip="$t('preferences.tabbar.maxCountTip')"
  >
    {{ $t('preferences.tabbar.maxCount') }}
  </NumberFieldItem>
  <SwitchItem v-model="tabbarDraggable" :disabled="!tabbarEnable">
    {{ $t('preferences.tabbar.draggable') }}
  </SwitchItem>
  <SwitchItem
    v-model="tabbarWheelable"
    :disabled="!tabbarEnable"
    :tip="$t('preferences.tabbar.wheelableTip')"
  >
    {{ $t('preferences.tabbar.wheelable') }}
  </SwitchItem>
  <SwitchItem v-model="tabbarMiddleClickToClose" :disabled="!tabbarEnable">
    {{ $t('preferences.tabbar.middleClickClose') }}
  </SwitchItem>
  <SwitchItem v-model="tabbarShowIcon" :disabled="!tabbarEnable">
    {{ $t('preferences.tabbar.icon') }}
  </SwitchItem>
  <SwitchItem v-model="tabbarShowMore" :disabled="!tabbarEnable">
    {{ $t('preferences.tabbar.showMore') }}
  </SwitchItem>
  <SwitchItem v-model="tabbarShowMaximize" :disabled="!tabbarEnable">
    {{ $t('preferences.tabbar.showMaximize') }}
  </SwitchItem>
  <SelectItem v-model="tabbarStyleType" :items="styleItems">
    {{ $t('preferences.tabbar.styleType.title') }}
  </SelectItem>
</template>

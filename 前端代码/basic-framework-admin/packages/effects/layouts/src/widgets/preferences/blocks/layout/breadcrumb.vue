<script setup lang="ts">
/**
 * 偏好设置「面包屑」分组：控制开关、图标、首页项与样式类型。
 * 仅在侧边导航类布局下由抽屉启用，父级 disabled 时其余选项整体置灰；
 * 只回写偏好字段，面包屑的实际渲染由布局组件负责。
 */
import type { SelectOption } from '@vben/types';

import { computed } from 'vue';

import { $t } from '@vben/locales';

import SwitchItem from '../switch-item.vue';
import ToggleItem from '../toggle-item.vue';

defineOptions({
  name: 'PreferenceBreadcrumbConfig',
});

const props = defineProps<{ disabled?: boolean }>();

const breadcrumbEnable = defineModel<boolean>('breadcrumbEnable');
const breadcrumbShowIcon = defineModel<boolean>('breadcrumbShowIcon');
const breadcrumbStyleType = defineModel<string>('breadcrumbStyleType');
const breadcrumbShowHome = defineModel<boolean>('breadcrumbShowHome');
const breadcrumbHideOnlyOne = defineModel<boolean>('breadcrumbHideOnlyOne');

const typeItems: SelectOption[] = [
  { label: $t('preferences.normal'), value: 'normal' },
  { label: $t('preferences.breadcrumb.background'), value: 'background' },
];

/** 其余选项是否禁用：面包屑总开关关闭，或父级传入 disabled 时整体置灰。 */
const disableItem = computed(() => {
  return !breadcrumbEnable.value || props.disabled;
});
</script>

<template>
  <SwitchItem v-model="breadcrumbEnable" :disabled="disabled">
    {{ $t('preferences.breadcrumb.enable') }}
  </SwitchItem>
  <SwitchItem v-model="breadcrumbHideOnlyOne" :disabled="disableItem">
    {{ $t('preferences.breadcrumb.hideOnlyOne') }}
  </SwitchItem>
  <SwitchItem v-model="breadcrumbShowIcon" :disabled="disableItem">
    {{ $t('preferences.breadcrumb.icon') }}
  </SwitchItem>
  <SwitchItem
    v-model="breadcrumbShowHome"
    :disabled="disableItem || !breadcrumbShowIcon"
  >
    {{ $t('preferences.breadcrumb.home') }}
  </SwitchItem>
  <ToggleItem
    v-model="breadcrumbStyleType"
    :disabled="disableItem"
    :items="typeItems"
  >
    {{ $t('preferences.breadcrumb.style') }}
  </ToggleItem>
</template>

<script setup lang="ts">
/**
 * 通用图标渲染：按 icon 的形态选择组件、远程图片或 iconify 名称三条分支。
 * 标签页、菜单等直接传图标组件或图标名；字符串为 http 地址时按远程图片渲染，
 * 都无法命中时由 fallback 决定是否显示默认图标。
 */
import type { Component } from 'vue';

import { computed } from 'vue';

import { IconDefault, IconifyIcon } from '@vben-core/icons';
import {
  isFunction,
  isHttpUrl,
  isObject,
  isString,
} from '@vben-core/shared/utils';

const props = defineProps<{
  // 没有是否显示默认图标
  fallback?: boolean;
  // 函数形态的图标就是函数式组件，Component 已覆盖 FunctionalComponent。
  icon?: Component | string;
}>();

const isRemoteIcon = computed(() => {
  return isString(props.icon) && isHttpUrl(props.icon);
});

const isComponent = computed(() => {
  const { icon } = props;
  return !isString(icon) && (isObject(icon) || isFunction(icon));
});
</script>

<template>
  <component :is="icon as Component" v-if="isComponent" v-bind="$attrs" />
  <img v-else-if="isRemoteIcon" :src="icon as string" v-bind="$attrs" />
  <IconifyIcon v-else-if="icon" v-bind="$attrs" :icon="icon as string" />
  <IconDefault v-else-if="fallback" v-bind="$attrs" />
</template>

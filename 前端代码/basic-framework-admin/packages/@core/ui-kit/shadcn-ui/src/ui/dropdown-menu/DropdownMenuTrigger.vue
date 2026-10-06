<script setup lang="ts">
/**
 * 下拉菜单触发元素：点击或键盘操作时切换菜单展开。
 * 只把 props 转发给 reka-ui 并补 outline-none 去掉聚焦轮廓，
 * 面板与菜单项由 DropdownMenuContent、DropdownMenuItem 渲染。
 */
import type { DropdownMenuTriggerProps } from 'reka-ui';

import { DropdownMenuTrigger, useForwardProps } from 'reka-ui';

const props = defineProps<DropdownMenuTriggerProps>();

const forwardedProps = useForwardProps(props);
</script>

<template>
  <DropdownMenuTrigger class="outline-none" v-bind="forwardedProps">
    <slot></slot>
  </DropdownMenuTrigger>
</template>

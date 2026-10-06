<script setup lang="ts">
/**
 * 认证页浮层工具栏：贴在认证外壳右上角，提供配色、布局形态与明暗主题三个快捷开关。
 * 入口由 toolbarList 指定（默认三项全开），主题开关另受主题偏好开关约束。
 * 只决定摆哪些入口，切换动作由 ../widgets 下各开关组件自理；
 * 认证外壳 authentication.vue 目前未接入它，只有组件测试直接挂载。
 */
import type { ToolbarType } from './types';

import { computed } from 'vue';

import { preferences } from '@vben/preferences';

import {
  AuthenticationColorToggle,
  AuthenticationLayoutToggle,
  ThemeToggle,
} from '../widgets';

/** 认证页工具条属性：toolbarList 指定要显示哪些快捷开关。 */
interface Props {
  toolbarList?: ToolbarType[];
}

defineOptions({
  name: 'AuthenticationToolbar',
});

const props = withDefaults(defineProps<Props>(), {
  /** 默认展示全部三种快捷开关：配色、布局形态与明暗主题。 */
  toolbarList: () => ['color', 'layout', 'theme'],
});

/** 是否显示配色开关：toolbarList 包含 color 时为 true。 */
const showColor = computed(() => props.toolbarList.includes('color'));
/** 是否显示布局形态开关：toolbarList 包含 layout 时为 true。 */
const showLayout = computed(() => props.toolbarList.includes('layout'));
/** 是否显示明暗主题开关：toolbarList 包含 theme 时为 true。 */
const showTheme = computed(() => props.toolbarList.includes('theme'));
</script>

<template>
  <div
    :class="{
      'bg-accent rounded-3xl px-3 py-1': toolbarList.length > 1,
    }"
    class="flex-center absolute right-2 top-4 z-10"
  >
    <!-- Only show on medium and larger screens -->
    <div class="hidden md:flex">
      <AuthenticationColorToggle v-if="showColor" />
      <AuthenticationLayoutToggle v-if="showLayout" />
    </div>
    <ThemeToggle v-if="showTheme && preferences.widget.themeToggle" />
  </div>
</template>

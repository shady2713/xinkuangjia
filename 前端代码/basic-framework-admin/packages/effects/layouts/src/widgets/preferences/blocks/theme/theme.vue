<script setup lang="ts">
/**
 * 明暗模式偏好：浅色、深色、跟随系统三选，并附带侧栏与顶栏的半深色开关。
 * 深色模式下两个半深色开关强制置灰；内置主题与主题色由 builtin 组件负责。
 */
import type { Component } from 'vue';

import type { ThemeModeType } from '@vben/types';

import { MoonStar, Sun, SunMoon } from '@vben/icons';
import { $t } from '@vben/locales';

import SwitchItem from '../switch-item.vue';

defineOptions({
  name: 'PreferenceTheme',
});

const modelValue = defineModel<string>({ default: 'auto' });
const themeSemiDarkSidebar = defineModel<boolean>('themeSemiDarkSidebar');
const themeSemiDarkHeader = defineModel<boolean>('themeSemiDarkHeader');

const THEME_PRESET: Array<{ icon: Component; name: ThemeModeType }> = [
  {
    icon: Sun,
    name: 'light',
  },
  {
    icon: MoonStar,
    name: 'dark',
  },
  {
    icon: SunMoon,
    name: 'auto',
  },
];

/** 主题卡片的高亮样式：与当前模式一致时返回描边类名，否则返回空数组。 */
function activeClass(theme: string): string[] {
  return theme === modelValue.value ? ['outline-box-active'] : [];
}

/** 把主题模式名翻译为界面文案；传入未知名称时返回 undefined，界面不显示名称。 */
function nameView(name: string) {
  switch (name) {
    case 'auto': {
      return $t('preferences.followSystem');
    }
    case 'dark': {
      return $t('preferences.theme.dark');
    }
    case 'light': {
      return $t('preferences.theme.light');
    }
  }
}
</script>

<template>
  <div class="flex w-full flex-wrap justify-between">
    <template v-for="theme in THEME_PRESET" :key="theme.name">
      <div
        class="flex cursor-pointer flex-col"
        @click="modelValue = theme.name"
      >
        <div
          :class="activeClass(theme.name)"
          class="outline-box flex-center py-4"
        >
          <component :is="theme.icon" class="mx-9 size-5" />
        </div>
        <div class="text-muted-foreground mt-2 text-center text-xs">
          {{ nameView(theme.name) }}
        </div>
      </div>
    </template>

    <SwitchItem
      v-model="themeSemiDarkSidebar"
      :disabled="modelValue === 'dark'"
      class="mt-6"
    >
      {{ $t('preferences.theme.darkSidebar') }}
    </SwitchItem>
    <SwitchItem v-model="themeSemiDarkHeader" :disabled="modelValue === 'dark'">
      {{ $t('preferences.theme.darkHeader') }}
    </SwitchItem>
  </div>
</template>

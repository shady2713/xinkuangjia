<script setup lang="ts">
/**
 * 偏好设置「内容区宽度」分组：在宽屏与紧凑两种主内容宽度间二选一。
 * 由偏好抽屉的外观区块挂载，选中项经 modelValue 回写布局宽度偏好；
 * 只负责选项渲染与高亮，不计算实际宽度，也不影响侧边栏形态。
 */
import type { Component } from 'vue';

import { computed } from 'vue';

import { $t } from '@vben/locales';

import { ContentCompact, ContentWide } from '../../icons';

defineOptions({
  name: 'PreferenceLayoutContent',
});

const modelValue = defineModel<string>({ default: 'wide' });

const components: Record<string, Component> = {
  compact: ContentCompact,
  wide: ContentWide,
};

const PRESET = computed(() => [
  {
    name: $t('preferences.wide'),
    type: 'wide',
  },
  {
    name: $t('preferences.compact'),
    type: 'compact',
  },
]);

function activeClass(theme: string): string[] {
  return theme === modelValue.value ? ['outline-box-active'] : [];
}
</script>

<template>
  <div class="flex w-full gap-5">
    <template v-for="theme in PRESET" :key="theme.name">
      <div
        class="flex w-[100px] cursor-pointer flex-col"
        @click="modelValue = theme.type"
      >
        <div :class="activeClass(theme.type)" class="outline-box flex-center">
          <component :is="components[theme.type]" />
        </div>
        <div class="text-muted-foreground mt-2 text-center text-xs">
          {{ theme.name }}
        </div>
      </div>
    </template>
  </div>
</template>

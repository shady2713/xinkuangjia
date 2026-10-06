<script setup lang="ts">
/**
 * 内置主题预设选择器：色板网格加取色器，同时决定全局主题色。
 *
 * 预设清单取自偏好层的 BUILT_IN_THEME_PRESETS，选中后按当前明暗模式
 * 回填对应主色，写回主题色时做了 300 毫秒节流；
 * custom 预设切换明暗时保留用户手选颜色，不覆盖为预设值。
 */
import type { BuiltinThemePreset } from '@vben/preferences';
import type { BuiltinThemeType } from '@vben/types';

import { computed, ref, watch } from 'vue';

import { UserRoundPen } from '@vben/icons';
import { $t } from '@vben/locales';
import { BUILT_IN_THEME_PRESETS } from '@vben/preferences';
import { convertToHsl, TinyColor } from '@vben/utils';

import { useThrottleFn } from '@vueuse/core';

defineOptions({
  name: 'PreferenceBuiltinTheme',
});

const props = defineProps<{ isDark: boolean }>();

const colorInput = ref();
const modelValue = defineModel<BuiltinThemeType>({ default: 'default' });
const themeColorPrimary = defineModel<string>('themeColorPrimary');

/** 节流写入主题色：300ms 内的连续取色只提交最后一次，首次与末次都会执行。 */
const updateThemeColorPrimary = useThrottleFn(
  (value: string) => {
    themeColorPrimary.value = value;
  },
  300,
  true,
  true,
);

/** 取色器显示的十六进制颜色值；主题色为空时由 TinyColor 回退为默认颜色。 */
const inputValue = computed(() => {
  return new TinyColor(themeColorPrimary.value || '').toHexString();
});

/** 内置主题预设清单的副本，供模板遍历渲染色板且不直接改动原数组。 */
const builtinThemePresets = computed(() => {
  return [...BUILT_IN_THEME_PRESETS];
});

/** 把内置主题类型翻译为界面文案；传入清单外的类型时返回 undefined。 */
function typeView(name: BuiltinThemeType) {
  switch (name) {
    case 'custom': {
      return $t('preferences.theme.builtin.custom');
    }
    case 'deep-blue': {
      return $t('preferences.theme.builtin.deepBlue');
    }
    case 'deep-green': {
      return $t('preferences.theme.builtin.deepGreen');
    }
    case 'default': {
      return $t('preferences.theme.builtin.default');
    }
    case 'gray': {
      return $t('preferences.theme.builtin.gray');
    }
    case 'green': {
      return $t('preferences.theme.builtin.green');
    }
    case 'neutral': {
      return $t('preferences.theme.builtin.neutral');
    }
    case 'orange': {
      return $t('preferences.theme.builtin.orange');
    }
    case 'pink': {
      return $t('preferences.theme.builtin.pink');
    }
    case 'rose': {
      return $t('preferences.theme.builtin.rose');
    }
    case 'sky-blue': {
      return $t('preferences.theme.builtin.skyBlue');
    }
    case 'slate': {
      return $t('preferences.theme.builtin.slate');
    }
    case 'violet': {
      return $t('preferences.theme.builtin.violet');
    }
    case 'yellow': {
      return $t('preferences.theme.builtin.yellow');
    }
    case 'zinc': {
      return $t('preferences.theme.builtin.zinc');
    }
  }
}

/** 选中某个内置主题预设时写入其类型；具体颜色由下方的监听按明暗模式回填。 */
function handleSelect(theme: BuiltinThemePreset) {
  modelValue.value = theme.type;
}

/** 取色器变化：把原生颜色值转成 HSL 后经节流写入主题色。 */
function handleInputChange(e: Event) {
  const target = e.target as HTMLInputElement;
  updateThemeColorPrimary(convertToHsl(target.value));
}

/** 以编程方式触发隐藏的原生取色器；取色器尚未渲染时静默跳过。 */
function selectColor() {
  colorInput.value?.[0]?.click?.();
}

watch(
  () => [modelValue.value, props.isDark] as [BuiltinThemeType, boolean],
  ([themeType, isDark], [_, isDarkPrev]) => {
    /** 与当前类型匹配的预设；类型不在预设清单中时为 undefined，此时不改动主题色。 */
    const theme = builtinThemePresets.value.find(
      (item) => item.type === themeType,
    );
    if (theme) {
      const primaryColor = isDark
        ? theme.darkPrimaryColor || theme.primaryColor
        : theme.primaryColor;

      if (!(theme.type === 'custom' && isDark !== isDarkPrev)) {
        themeColorPrimary.value = primaryColor || theme.color;
      }
    }
  },
);
</script>

<template>
  <div class="flex w-full flex-wrap justify-between">
    <template v-for="theme in builtinThemePresets" :key="theme.type">
      <div class="flex cursor-pointer flex-col" @click="handleSelect(theme)">
        <div
          :class="{
            'outline-box-active': theme.type === modelValue,
          }"
          class="outline-box flex-center group cursor-pointer"
        >
          <template v-if="theme.type !== 'custom'">
            <div
              :style="{ backgroundColor: theme.color }"
              class="mx-9 my-2 size-5 rounded-md"
            ></div>
          </template>
          <template v-else>
            <div class="size-full px-9 py-2" @click.stop="selectColor">
              <div class="flex-center relative size-5 rounded-sm">
                <UserRoundPen
                  class="z-1 absolute size-5 opacity-60 group-hover:opacity-100"
                />
                <input
                  ref="colorInput"
                  :value="inputValue"
                  class="absolute inset-0 opacity-0"
                  type="color"
                  @input="handleInputChange"
                />
              </div>
            </div>
          </template>
        </div>
        <div class="text-muted-foreground my-2 text-center text-xs">
          {{ typeView(theme.type) }}
        </div>
      </div>
    </template>
  </div>
</template>

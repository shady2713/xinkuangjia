<script lang="ts" setup>
/** 偏好设置入口：把全局 preferences 映射为抽屉的属性与事件后透传。 */
import type { SupportedLanguagesType } from '@vben/locales';

import { computed, useAttrs } from 'vue';

import { Settings } from '@vben/icons';
import { $t, loadLocaleMessages } from '@vben/locales';
import { preferences, updatePreferences } from '@vben/preferences';
import { capitalizeFirstLetter } from '@vben/utils';

import { useVbenDrawer } from '@vben-core/popup-ui';
import { VbenButton } from '@vben-core/shadcn-ui';

import PreferencesDrawer from './preferences-drawer.vue';

/** 判断外部传入的语言是否为当前支持的语言。 */
function isSupportedLanguage(value: unknown): value is SupportedLanguagesType {
  return value === 'en-US' || value === 'zh-CN';
}

const [Drawer, drawerApi] = useVbenDrawer({
  connectedComponent: PreferencesDrawer,
});

const rawAttrs = useAttrs();

const attrs = computed(
  /**
   * 把全局 preferences 摊平成组件 props。
   * 两层结构 preferences.widget.fullscreen 会映射为 widgetFullscreen；
   * 这样抽屉只需声明扁平属性，无需感知偏好项的分组。
   * @returns 以驼峰键组织的偏好值表。
   */
  () => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(preferences)) {
      for (const [subKey, subValue] of Object.entries(value)) {
        result[`${key}${capitalizeFirstLetter(subKey)}`] = subValue;
      }
    }
    return result;
  },
);

/**
 * 把全局 preferences 摊平成组件事件监听。
 * 与 attrs 同构：preferences.widget.fullscreen 对应 update:widgetFullscreen，
 * 抽屉改值时按分组写回，并顺带切换语言包。非对象的顶层偏好项直接透传。
 * @returns 以 `update:` 前缀键组织的写回回调表。
 */
const listen = computed(
  /**
   * 把全局 preferences 摊平成组件事件监听。
   * 与 attrs 同构：preferences.widget.fullscreen 对应 update:widgetFullscreen，
   * 抽屉改值时按分组写回，并顺带切换语言包。非对象的顶层偏好项直接透传。
   * @returns 以 `update:` 前缀键组织的写回回调表。
   */
  () => {
    // 键形如 `update:widgetFullscreen`，值为对应偏好项的写回回调。
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(preferences)) {
      if (typeof value === 'object') {
        for (const subKey of Object.keys(value)) {
          result[`update:${key}${capitalizeFirstLetter(subKey)}`] =
            /**
             * 写回单个偏好项；locale 额外触发语言包切换。
             * @param val 抽屉回传的新值，形状由对应偏好项决定。
             */
            (val: unknown) => {
              updatePreferences({ [key]: { [subKey]: val } });
              // 偏好项 schema 已限定 locale 取值，这里按受支持语言收窄后切换语言包，
              // 避免外部传入非法语言时 loadLocaleMessages 抛错中断整条写回链路。
              if (
                key === 'app' &&
                subKey === 'locale' &&
                isSupportedLanguage(val)
              ) {
                loadLocaleMessages(val);
              }
            };
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  },
);
const drawerBindings = computed<Record<string, unknown>>(
  /**
   * 汇总透传给偏好抽屉的属性与事件。
   * class 为空时整键删除，避免向组件传一个无意义的空 class。
   * @returns 合并后的抽屉绑定属性。
   */
  () => {
    const result: Record<string, unknown> = {
      ...(rawAttrs as Record<string, unknown>),
      ...attrs.value,
    };
    if (result.class === null || result.class === undefined) {
      delete result.class;
    }
    return result;
  },
);
</script>
<template>
  <div>
    <Drawer v-bind="drawerBindings" v-on="listen" />

    <div @click="() => drawerApi.open()">
      <slot>
        <VbenButton
          :title="$t('preferences.title')"
          class="bg-primary flex-col-center size-10 cursor-pointer rounded-l-lg rounded-r-none border-none"
        >
          <Settings class="size-5" />
        </VbenButton>
      </slot>
    </div>
  </div>
</template>

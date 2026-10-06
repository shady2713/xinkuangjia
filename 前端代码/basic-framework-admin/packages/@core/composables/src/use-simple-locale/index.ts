/**
 * 轻量多语言：以共享单例提供 $t，内置 zh-CN 与 en-US 两组固定文案。
 * 供表单操作条、动作弹窗等核心组件在拿不到应用 i18n 实例时取词；
 * 完整业务词条仍由 packages/locales 提供，它负责在切换语言时同步调用本模块。
 */
import type { Locale } from './messages';

import { computed, ref } from 'vue';

import { createSharedComposable } from '@vueuse/core';

import { getMessages } from './messages';

export const useSimpleLocale = createSharedComposable(() => {
  const currentLocale = ref<Locale>('zh-CN');

  const setSimpleLocale = (locale: Locale) => {
    currentLocale.value = locale;
  };

  const $t = computed(() => {
    const localeMessages = getMessages(currentLocale.value);
    return (key: string) => {
      return localeMessages[key] || key;
    };
  });
  return {
    $t,
    currentLocale,
    setSimpleLocale,
  };
});

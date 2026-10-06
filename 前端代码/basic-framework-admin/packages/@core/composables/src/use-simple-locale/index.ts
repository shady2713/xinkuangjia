/**
 * 轻量多语言：以共享单例提供 $t，内置 zh-CN 与 en-US 两组固定文案。
 * 供表单操作条、动作弹窗等核心组件在拿不到应用 i18n 实例时取词；
 * 完整业务词条仍由 packages/locales 提供，它负责在切换语言时同步调用本模块。
 */
import type { Locale } from './messages';

import { computed, ref } from 'vue';

import { createSharedComposable } from '@vueuse/core';

import { getMessages } from './messages';

/**
 * 轻量多语言的共享单例：全局只有一份语言状态，多处调用拿到的是同一份引用。
 * @returns $t 取词函数、当前语言与切换语言的方法。
 */
export const useSimpleLocale = createSharedComposable(() => {
  const currentLocale = ref<Locale>('zh-CN');

  /** 切换本模块词条的语言，不影响 packages/locales 维护的业务词条。 */
  const setSimpleLocale = (locale: Locale) => {
    currentLocale.value = locale;
  };

  /** 取词函数：按当前语言查表，键不存在时原样返回键名。 */
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

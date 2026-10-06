/**
 * 应用国际化装配：合并 langs 目录的业务文案、element-plus 与 dayjs 语言包，
 * 并导出 elementLocale 供组件库透传；语言包按需动态加载，缺失只告警不阻断。
 */
import type { Language } from 'element-plus/es/locale';

import type { App } from 'vue';

import type { LocaleSetupOptions, SupportedLanguagesType } from '@vben/locales';

import { ref } from 'vue';

import {
  $t,
  setupI18n as coreSetup,
  loadLocalesMapFromDir,
} from '@vben/locales';
import { preferences } from '@vben/preferences';
import { logWarn } from '@vben/utils';

import dayjs from 'dayjs';
import enLocale from 'element-plus/es/locale/lang/en';
import defaultLocale from 'element-plus/es/locale/lang/zh-cn';

const elementLocale = ref<Language>(defaultLocale);

const modules = import.meta.glob('./langs/**/*.json');

const localesMap = loadLocalesMapFromDir(
  /\.\/langs\/([^/]+)\/(.*)\.json$/,
  modules,
);
/**
 * 加载应用特有的语言包
 * 这里也可以改造为从服务端获取翻译数据
 * @param lang
 */
async function loadMessages(lang: SupportedLanguagesType) {
  const [appLocaleMessages] = await Promise.all([
    localesMap[lang]?.(),
    loadThirdPartyMessage(lang),
  ]);
  return appLocaleMessages?.default;
}

/**
 * 加载第三方组件库的语言包
 * @param lang
 */
async function loadThirdPartyMessage(lang: SupportedLanguagesType) {
  await Promise.all([loadElementLocale(lang), loadDayjsLocale(lang)]);
}

/** dayjs 语言包类型：与 `await import('dayjs/locale/...')` 的返回值一致。 */
type DayjsLocale = Awaited<typeof import('dayjs/locale/en')>;

/**
 * 应用已加载的 dayjs 语言包。
 *
 * 语言包由调用方加载后显式传入：动态导入成功时交出语言包对象，加载不出内容时交出空值。
 * 空值不能直接交给 `dayjs.locale()`——传空会重置回 dayjs 内置语言，日期格式会在用户切换
 * 语言后悄悄退回默认值；这里改为只告警并保持当前语言，让问题留在日志里而不是界面上。
 *
 * @param locale 已加载的 dayjs 语言包，空值表示语言包缺失
 * @param lang 当前语言标识，仅用于告警文案
 */
export function applyDayjsLocale(
  locale: DayjsLocale | undefined,
  lang: SupportedLanguagesType,
) {
  if (locale) {
    dayjs.locale(locale);
  } else {
    logWarn('i18n:dayjs-locale', `Failed to load dayjs locale for ${lang}`);
  }
}

/**
 * 加载dayjs的语言包
 * @param lang
 */
async function loadDayjsLocale(lang: SupportedLanguagesType) {
  let locale: DayjsLocale | undefined;
  switch (lang) {
    case 'en-US': {
      locale = await import('dayjs/locale/en');
      break;
    }
    case 'zh-CN': {
      locale = await import('dayjs/locale/zh-cn');
      break;
    }
    // 默认使用英语
    default: {
      locale = await import('dayjs/locale/en');
    }
  }
  applyDayjsLocale(locale, lang);
}

/**
 * 加载element-plus的语言包
 * @param lang
 */
async function loadElementLocale(lang: SupportedLanguagesType) {
  switch (lang) {
    case 'en-US': {
      elementLocale.value = enLocale;
      break;
    }
    case 'zh-CN': {
      elementLocale.value = defaultLocale;
      break;
    }
  }
}

/**
 * 按应用偏好装配 vue-i18n，让全站文案、element-plus 与 dayjs 共用同一语言。
 *
 * 默认语言取 `preferences.app.locale`，翻译内容由 loadMessages 提供，非生产环境开启缺失文案告警；
 * options 可覆盖上述任意一项，业务项目接入自有语言包时使用。
 *
 * @param app 待安装 i18n 插件的应用实例
 * @param options 覆盖默认语言、文案加载器与缺失告警开关的配置，缺省沿用上述取值
 */
async function setupI18n(app: App, options: LocaleSetupOptions = {}) {
  await coreSetup(app, {
    defaultLocale: preferences.app.locale,
    loadMessages,
    missingWarn: !import.meta.env.PROD,
    ...options,
  });
}

export { $t, elementLocale, setupI18n };

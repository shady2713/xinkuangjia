/**
 * 国际化运行时：创建 vue-i18n 实例，按语言目录聚合 langs 下的分片语言包，
 * setupI18n 负责安装，loadLocaleMessages 负责切换语言、写回 html lang
 * 并合并调用方追加的消息；语言开关由偏好设置与语言切换组件触发。
 */
import type { App } from 'vue';
import type { Locale } from 'vue-i18n';

import type {
  ImportLocaleFn,
  LoadMessageFn,
  LocaleMessagesRecord,
  LocaleSetupOptions,
  SupportedLanguagesType,
} from './typing';

import { unref } from 'vue';
import { createI18n } from 'vue-i18n';

import { useSimpleLocale } from '@vben-core/composables';

const i18n = createI18n({
  globalInjection: true,
  legacy: false,
  locale: '',
  messages: {},
});

const modules = import.meta.glob('./langs/**/*.json');

const { setSimpleLocale } = useSimpleLocale();

const localesMap = loadLocalesMapFromDir(
  /\.\/langs\/([^/]+)\/(.*)\.json$/,
  modules,
);
let loadMessages: LoadMessageFn;

/**
 * Load locale modules
 * 从模块路径里取出文件名作为语言键，把同一语言的分片导入函数收集成映射。
 * @param modules - 路径到动态导入函数的映射，通常来自 import.meta.glob，键形如 ./langs/zh-CN/common.json。
 * @returns 语言到其分片导入函数的映射；路径里取不出文件名的模块会被跳过。
 */
function loadLocalesMap(
  modules: Record<
    string,
    /* 按路径懒加载单个语言包分片。 */ () => Promise<unknown>
  >,
) {
  const localesMap: Record<Locale, ImportLocaleFn> = {};

  for (const [path, loadLocale] of Object.entries(modules)) {
    const key = path.match(/([\w-]*)\.(json)/)?.[1];
    if (key) {
      localesMap[key] = loadLocale as ImportLocaleFn;
    }
  }
  return localesMap;
}

/**
 * 读取语言包动态导入结果的 default 导出。
 * 动态导入的返回值在类型上是未知的，翻译文件可能没有 default 导出或直接导出内容本身，
 * 因此先判断模块形状再取值，取不到时返回 undefined，交由 vue-i18n 按缺失语言包处理。
 * @param module 动态导入得到的模块对象。
 * @returns 模块的 default 导出；模块不是对象或没有 default 导出时返回 undefined。
 */
function readDefaultExport(module: unknown): unknown {
  if (module === null || typeof module !== 'object') {
    return module;
  }
  return 'default' in module ? module.default : undefined;
}

/**
 * 按目录结构加载语言包模块。
 * @param regexp 用于从模块路径中解析语言与文件名的正则，需含语言组与文件名组。
 * @param modules 路径到动态导入函数的映射，通常来自 import.meta.glob。
 * @returns 语言到其导入函数的映射，供后续按语言读取 default 导出。
 */
function loadLocalesMapFromDir(
  regexp: RegExp,
  modules: Record<
    string,
    /* 按路径懒加载单个语言包分片。 */ () => Promise<unknown>
  >,
): Record<Locale, ImportLocaleFn> {
  // 语言到「文件名 → 导入函数」的临时分组，稍后再折叠成每语言一个导入函数。
  const localesRaw: Record<
    Locale,
    Record<string, /* 按路径懒加载单个语言包分片。 */ () => Promise<unknown>>
  > = {};
  const localesMap: Record<Locale, ImportLocaleFn> = {};

  // Iterate over the modules to extract language and file names
  for (const path in modules) {
    const match = path.match(regexp);
    if (match) {
      const [_, locale, fileName] = match;
      if (locale && fileName) {
        if (!localesRaw[locale]) {
          localesRaw[locale] = {};
        }
        if (modules[path]) {
          localesRaw[locale][fileName] = modules[path];
        }
      }
    }
  }

  // Convert raw locale data into async import functions
  for (const [locale, files] of Object.entries(localesRaw)) {
    localesMap[locale] =
      /**
       * 读取该语言下所有分片的 default 导出并合并为一份消息字典。
       * @returns 该语言的完整消息字典，供 vue-i18n 设为当前语言消息。
       */
      async () => {
        // 语言包内容形状完全由各语言文件决定，按嵌套消息字典收集后交给 vue-i18n 解释
        const messages: LocaleMessagesRecord = {};
        for (const [fileName, importFn] of Object.entries(files)) {
          const content = readDefaultExport(await importFn());
          if (content !== null && typeof content === 'object') {
            messages[fileName] = content as LocaleMessagesRecord;
          }
        }
        return { default: messages };
      };
  }

  return localesMap;
}

/**
 * Set i18n language
 * 切换 vue-i18n 的当前语言，并把 html 标签的 lang 属性改成同一取值。
 * @param locale - 目标语言标识。
 */
function setI18nLanguage(locale: Locale) {
  i18n.global.locale.value = locale;

  document?.querySelector('html')?.setAttribute('lang', locale);
}

/**
 * 安装 vue-i18n 并载入默认语言包。
 * 缺词告警默认关闭，只有 options.missingWarn 为真时才会在控制台提示。
 * @param app - 目标应用实例，i18n 会以插件形式注册到它上面。
 * @param options - 初始化选项：默认语言、追加消息的加载函数与缺词告警开关。
 * @returns 默认语言包载入完成后的 Promise，没有业务返回值。
 */
async function setupI18n(app: App, options: LocaleSetupOptions = {}) {
  const { defaultLocale = 'zh-CN' } = options;
  // app可以自行扩展一些第三方库和组件库的国际化
  loadMessages = options.loadMessages || (async () => ({}));
  app.use(i18n);
  await loadLocaleMessages(defaultLocale);

  // 在控制台打印警告
  i18n.global.setMissingHandler((locale, key) => {
    if (options.missingWarn && key !== 'OAuth 2.0' && key.includes('.')) {
      console.warn(
        `[intlify] Not found '${key}' key in '${locale}' locale messages.`,
      );
    }
  });
}

/**
 * Load locale messages
 * 切换语言：已经是当前语言时只同步 html lang，否则载入该语言分片并合并调用方追加的消息。
 * @param lang - 目标语言标识。
 * @returns 语言切换流程的完成信号，没有业务返回值。
 */
async function loadLocaleMessages(lang: SupportedLanguagesType) {
  if (unref(i18n.global.locale) === lang) {
    return setI18nLanguage(lang);
  }
  setSimpleLocale(lang);

  const message = await localesMap[lang]?.();

  if (message?.default) {
    i18n.global.setLocaleMessage(lang, message.default);
  }

  const mergeMessage = await loadMessages(lang);
  i18n.global.mergeLocaleMessage(lang, mergeMessage);

  return setI18nLanguage(lang);
}

export {
  i18n,
  loadLocaleMessages,
  loadLocalesMap,
  loadLocalesMapFromDir,
  setupI18n,
};

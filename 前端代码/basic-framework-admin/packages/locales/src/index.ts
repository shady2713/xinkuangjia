/**
 * 国际化对外出口：转发 ./i18n 的实例、语言包加载与初始化能力，
 * 并固定导出 $t、$te 两个全局翻译快捷函数，供非组件环境直接取词。
 * 语言包文件读取与 vue-i18n 实例创建由 ./i18n 负责，类型契约来自 ./typing。
 */
import {
  i18n,
  loadLocaleMessages,
  loadLocalesMap,
  loadLocalesMapFromDir,
  setupI18n,
} from './i18n';

const $t = i18n.global.t;
const $te = i18n.global.te;

export {
  $t,
  $te,
  i18n,
  loadLocaleMessages,
  loadLocalesMap,
  loadLocalesMapFromDir,
  setupI18n,
};
export {
  type ImportLocaleFn,
  type LocaleMessagesRecord,
  type LocaleSetupOptions,
  type SupportedLanguagesType,
} from './typing';
export type { CompileError } from '@intlify/core-base';

export { useI18n } from 'vue-i18n';

export type { Locale } from 'vue-i18n';

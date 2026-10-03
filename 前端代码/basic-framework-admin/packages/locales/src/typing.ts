export type SupportedLanguagesType = 'en-US' | 'zh-CN';

/**
 * 语言包消息字典。
 * vue-i18n 的消息是嵌套结构：叶子节点是文案字符串，中间层是按语言键名分组的子字典，
 * 层级完全由各语言文件决定。这里用递归接口如实描述，
 * 避免退化成扁平的 Record<string, string> 而与实际语言包结构不符
 * （此前该类型靠 any 兜底才得以通过编译）。
 */
export interface LocaleMessagesRecord {
  [key: string]: LocaleMessagesRecord | string;
}

/**
 * 语言包导入函数。
 * 语言文件的 default 导出即上述消息字典。
 * @returns 该语言对应的消息字典，异步加载。
 */
export type ImportLocaleFn = () => Promise<{ default: LocaleMessagesRecord }>;

/**
 * 追加语言包函数：应用可在此补充自身的翻译，返回 undefined 表示本次没有增量。
 * @param lang 需要追加翻译的语言。
 * @returns 增量消息字典；没有增量时返回 undefined。
 */
export type LoadMessageFn = (
  lang: SupportedLanguagesType,
) => Promise<LocaleMessagesRecord | undefined>;

export interface LocaleSetupOptions {
  /**
   * Default language
   * @default zh-CN
   */
  defaultLocale?: SupportedLanguagesType;
  /**
   * Load message function
   * @param lang
   * @returns
   */
  loadMessages?: LoadMessageFn;
  /**
   * Whether to warn when the key is not found
   */
  missingWarn?: boolean;
}

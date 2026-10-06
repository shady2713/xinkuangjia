/**
 * 轻量多语言的词条表：定义可用的语言取值，并维护 zh-CN、en-US 两组固定文案。
 * getMessages 只按语言返回整张表，键缺失时的回退由取词方处理，此处不做校验。
 */
export type Locale = 'en-US' | 'zh-CN';

/** 内置词条表：语言到「键 → 文案」的映射，缺键时由取词方回退为键名。 */
export const messages: Record<Locale, Record<string, string>> = {
  'en-US': {
    cancel: 'Cancel',
    collapse: 'Collapse',
    confirm: 'Confirm',
    expand: 'Expand',
    prompt: 'Prompt',
    reset: 'Reset',
    submit: 'Submit',
  },
  'zh-CN': {
    cancel: '取消',
    collapse: '收起',
    confirm: '确认',
    expand: '展开',
    prompt: '提示',
    reset: '重置',
    submit: '提交',
  },
};

/**
 * 取指定语言的全部词条。
 * @param locale - 语言标识，只支持 en-US 与 zh-CN。
 * @returns 该语言的「键 → 文案」映射，与 messages 中的对应项是同一个对象。
 */
export const getMessages = (locale: Locale) => messages[locale];

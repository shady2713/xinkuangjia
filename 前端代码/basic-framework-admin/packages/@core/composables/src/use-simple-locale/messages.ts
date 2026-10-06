/**
 * 轻量多语言的词条表：定义可用的语言取值，并维护 zh-CN、en-US 两组固定文案。
 * getMessages 只按语言返回整张表，键缺失时的回退由取词方处理，此处不做校验。
 */
export type Locale = 'en-US' | 'zh-CN';

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

export const getMessages = (locale: Locale) => messages[locale];

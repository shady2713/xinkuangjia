/**
 * 框架级常量：登录页路径与界面可选语言等跨模块复用的固定值。
 * 语言列表供语言切换与偏好设置使用，登录路径供认证页跳回登录入口。
 * 业务字典与状态枚举另由 dict-enum、biz-*-enum 提供。
 */
/**
 * @zh_CN 登录页面 url 地址
 */
export const LOGIN_PATH = '/auth/login';

/** 语言下拉项：label 为展示名，value 为语言标识。 */
export interface LanguageOption {
  label: string;
  value: 'en-US' | 'zh-CN';
}

/**
 * Supported languages
 * 界面可选语言列表，顺序即语言切换组件的展示顺序。
 */
export const SUPPORT_LANGUAGES: LanguageOption[] = [
  {
    label: '简体中文',
    value: 'zh-CN',
  },
  {
    label: 'English',
    value: 'en-US',
  },
];

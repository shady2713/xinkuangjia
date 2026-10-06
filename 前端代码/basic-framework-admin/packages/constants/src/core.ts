/**
 * 框架级常量：登录页路径与界面可选语言等跨模块复用的固定值。
 * 语言列表供语言切换与偏好设置使用，登录路径供认证页跳回登录入口。
 * 业务字典与状态枚举另由 dict-enum、biz-*-enum 提供。
 */
/**
 * @zh_CN 登录页面 url 地址
 */
export const LOGIN_PATH = '/auth/login';

export interface LanguageOption {
  label: string;
  value: 'en-US' | 'zh-CN';
}

/**
 * Supported languages
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

import type {
  AuthPageLayoutType,
  BuiltinThemeType,
  RouteMeta as IRouteMeta,
  ThemeModeType,
} from '@vben-core/typings';

import 'vue-router';

declare module 'vue-router' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface RouteMeta extends IRouteMeta {}
}

/**
 * 管理平台运行时配置，只声明代码从 `_app.config.js` 实际读取的字段。
 *
 * @author 李杰
 */
export interface VbenAdminProAppConfigRaw {
  /** API 加密算法名称。 */
  VITE_APP_API_ENCRYPT_ALGORITHM: string;
  /** 是否启用 API 请求加密。 */
  VITE_APP_API_ENCRYPT_ENABLE: RuntimeBoolean;
  /** API 加密标识请求头。 */
  VITE_APP_API_ENCRYPT_HEADER: string;
  /** 请求数据加密密钥；该值对浏览器可见。 */
  VITE_APP_API_ENCRYPT_REQUEST_KEY: string;
  /** 响应数据解密密钥；该值对浏览器可见。 */
  VITE_APP_API_ENCRYPT_RESPONSE_KEY: string;
  /** 登录页布局。 */
  VITE_APP_AUTH_PAGE_LAYOUT: AuthPageLayoutType;
  /** 登录图形验证码开关。 */
  VITE_APP_CAPTCHA_ENABLE: RuntimeBoolean;
  /** 登录表单默认密码；生产配置必须为空。 */
  VITE_APP_DEFAULT_PASSWORD: string;
  /** 登录表单默认账号。 */
  VITE_APP_DEFAULT_USERNAME: string;
  /** 页面文档提醒开关。 */
  VITE_APP_DOCALERT_ENABLE: RuntimeBoolean;
  /** 是否显示偏好设置入口。 */
  VITE_APP_ENABLE_PREFERENCES: RuntimeBoolean;
  /** 是否显示顶部全局搜索入口。 */
  VITE_APP_GLOBAL_SEARCH_ENABLE: RuntimeBoolean;
  /** 应用命名空间。 */
  VITE_APP_NAMESPACE: string;
  /** Pinia 客户端存储混淆密钥。 */
  VITE_APP_STORE_SECURE_KEY: string;
  /** 内置主题名称。 */
  VITE_APP_THEME_BUILTIN_TYPE: BuiltinThemeType;
  /** 主题色。 */
  VITE_APP_THEME_COLOR_PRIMARY: string;
  /** 明暗模式。 */
  VITE_APP_THEME_MODE: ThemeModeType;
  /** 是否显示明暗主题切换。 */
  VITE_APP_THEME_TOGGLE_ENABLE: RuntimeBoolean;
  /** 浏览器运行时显示的应用名称。 */
  VITE_APP_TITLE: string;
  /** 后端 API 基础地址。 */
  VITE_GLOB_API_URL: string;
  /** 钉钉登录客户端 ID；留空时不启用钉钉登录。 */
  VITE_GLOB_AUTH_DINGDING_CLIENT_ID: string;
  /** 钉钉登录企业 ID；留空时不启用钉钉登录。 */
  VITE_GLOB_AUTH_DINGDING_CORP_ID: string;
  /** 文件上传方式。 */
  VITE_UPLOAD_TYPE: 'client' | 'server';
}

/** 运行时布尔配置的字符串表示。 */
type RuntimeBoolean = 'false' | 'true';

interface AuthConfig {
  dingding?: {
    clientId: string;
    corpId: string;
  };
}

export interface ApplicationConfig {
  apiURL: string;
  auth: AuthConfig;
}

declare global {
  interface Window {
    _VBEN_ADMIN_PRO_APP_CONF_: VbenAdminProAppConfigRaw;
  }
}

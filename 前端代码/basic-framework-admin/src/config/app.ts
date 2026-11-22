/**
 * 运行时公开配置读取入口：优先读取 `_app.config.js`，缺省时回退构建期环境变量。
 */
export interface AppConfig {
  appTitle: string;
  apiBaseUrl: string;
  captchaEnabled: boolean;
  uploadType: 'client' | 'server';
}

export function getAppConfig(): AppConfig {
  const runtime =
    typeof window !== 'undefined' ? window._BASIC_FRAMEWORK_APP_CONF_ : undefined;
  return {
    appTitle: runtime?.VITE_APP_TITLE || import.meta.env.VITE_APP_TITLE || '管理平台',
    apiBaseUrl:
      runtime?.VITE_GLOB_API_URL || import.meta.env.VITE_GLOB_API_URL || '/admin-api',
    captchaEnabled: (runtime?.VITE_APP_CAPTCHA_ENABLE ?? 'true') === 'true',
    uploadType: runtime?.VITE_UPLOAD_TYPE === 'client' ? 'client' : 'server',
  };
}

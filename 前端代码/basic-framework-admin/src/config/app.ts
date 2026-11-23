/**
 * 运行时公开配置读取入口：优先读取 `_app.config.js`，缺省时回退构建期环境变量。
 */
export interface AppConfig {
  appTitle: string;
  apiBaseUrl: string;
  captchaEnabled: boolean;
}

export function getAppConfig(): AppConfig {
  const runtime =
    typeof window !== 'undefined' ? window._BASIC_FRAMEWORK_APP_CONF_ : undefined;
  const captchaFlag =
    runtime?.VITE_APP_CAPTCHA_ENABLE ??
    import.meta.env.VITE_APP_CAPTCHA_ENABLE ??
    'true';
  return {
    appTitle:
      runtime?.VITE_APP_TITLE || import.meta.env.VITE_APP_TITLE || '企业级中后台',
    apiBaseUrl:
      runtime?.VITE_GLOB_API_URL ||
      import.meta.env.VITE_GLOB_API_URL ||
      '/admin-api',
    captchaEnabled: String(captchaFlag) === 'true',
  };
}

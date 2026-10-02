import type {
  ApplicationConfig,
  VbenAdminProAppConfigRaw,
} from '@vben/types/global';

/**
 * 获取应用接口和第三方认证配置。
 *
 * 生产环境始终使用 `app.config.js`；开发环境仅允许 `.env` 中的 API 地址覆盖默认值，
 * 其余运行时配置仍统一来自 `app.config.js`。
 *
 * @param env Vite 开发环境变量
 * @param isProduction 是否为生产构建
 * @returns 应用接口和认证配置
 */
export function useAppConfig(
  env: Record<string, any>,
  isProduction: boolean,
): ApplicationConfig {
  const config = window._VBEN_ADMIN_PRO_APP_CONF_;
  const developmentApiURL = isProduction ? undefined : env.VITE_GLOB_API_URL;

  const { VITE_GLOB_AUTH_DINGDING_CORP_ID, VITE_GLOB_AUTH_DINGDING_CLIENT_ID } =
    config;

  const applicationConfig: ApplicationConfig = {
    apiURL: developmentApiURL || config.VITE_GLOB_API_URL,
    auth: {},
  };
  if (VITE_GLOB_AUTH_DINGDING_CORP_ID && VITE_GLOB_AUTH_DINGDING_CLIENT_ID) {
    applicationConfig.auth.dingding = {
      clientId: VITE_GLOB_AUTH_DINGDING_CLIENT_ID,
      corpId: VITE_GLOB_AUTH_DINGDING_CORP_ID,
    };
  }

  return applicationConfig;
}

export function isTenantEnable(): boolean {
  return false;
}

/** 返回运行时配置字段；服务端渲染等无浏览器场景返回 undefined。 */
function getRuntimeConfigValue(key: keyof VbenAdminProAppConfigRaw) {
  return typeof window === 'undefined'
    ? undefined
    : window._VBEN_ADMIN_PRO_APP_CONF_?.[key];
}

/** 判断登录图形验证码是否启用。 */
export function isCaptchaEnable(): boolean {
  return getRuntimeConfigValue('VITE_APP_CAPTCHA_ENABLE') === 'true';
}

/** 判断页面文档提醒是否启用。 */
export function isDocAlertEnable(): boolean {
  return getRuntimeConfigValue('VITE_APP_DOCALERT_ENABLE') === 'true';
}

/**
 * 运行时应用配置读取：从 app.config.js 注入的全局对象取接口地址与钉钉认证，
 * 开发环境允许 .env 的 VITE_GLOB_API_URL 覆盖接口地址。
 *
 * 另提供验证码、文档提醒开关与固定关闭的租户开关；
 * 本模块只读配置，不含请求实例与登录流程。
 */
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
  env: Record<string, unknown>,
  isProduction: boolean,
): ApplicationConfig {
  const config = window._VBEN_ADMIN_PRO_APP_CONF_;
  // Vite 环境变量在 .env 中声明为字符串；开发期允许用 VITE_GLOB_API_URL 覆盖配置里的地址。
  const developmentApiURL = isProduction
    ? undefined
    : (env.VITE_GLOB_API_URL as string | undefined);

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

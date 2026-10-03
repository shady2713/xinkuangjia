import { defineOverridesPreferences } from '@vben/preferences';

const appConfig = window._VBEN_ADMIN_PRO_APP_CONF_;

/**
 * 将 app.config.js 中的固定配置映射为框架偏好，并补充管理平台运行配置。
 */
export const overridesPreferences = defineOverridesPreferences({
  app: {
    /** 后端路由模式：菜单由共用后台按 super_admin 平台类型返回。 */
    accessMode: 'backend',
    authPageLayout: appConfig.VITE_APP_AUTH_PAGE_LAYOUT,
    // 旧入口下线后统一进入概览页，避免登录跳转到已移除的历史路由。
    defaultHomePath: '/dashboard',
    enablePreferences: appConfig.VITE_APP_ENABLE_PREFERENCES === 'true',
    enableRefreshToken: true,
    /** 本应用认证失效固定完整退出并跳转登录；不展示旧页面内续登选项。 */
    loginExpiredMode: 'page',
    name: appConfig.VITE_APP_TITLE,
  },
  logo: {
    source: '/brand-logo.svg',
    sourceDark: '/brand-logo.svg',
  },
  copyright: {
    companyName: appConfig.VITE_APP_TITLE,
    companySiteLink: '',
  },
  theme: {
    builtinType: appConfig.VITE_APP_THEME_BUILTIN_TYPE,
    colorPrimary: appConfig.VITE_APP_THEME_COLOR_PRIMARY,
    mode: appConfig.VITE_APP_THEME_MODE,
  },
  widget: {
    globalSearch: appConfig.VITE_APP_GLOBAL_SEARCH_ENABLE === 'true',
    themeToggle: appConfig.VITE_APP_THEME_TOGGLE_ENABLE === 'true',
  },
});

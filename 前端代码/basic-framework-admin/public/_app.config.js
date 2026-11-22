/**
 * 本地开发期默认运行时公开配置（与 docker/app.config.js 保持一致）。
 */
window._BASIC_FRAMEWORK_APP_CONF_ = {
  VITE_APP_TITLE: '管理平台',
  VITE_GLOB_API_URL: '/admin-api',
  VITE_APP_CAPTCHA_ENABLE: 'true',
  VITE_UPLOAD_TYPE: 'server',
};

Object.freeze(window._BASIC_FRAMEWORK_APP_CONF_);
Object.defineProperty(window, '_BASIC_FRAMEWORK_APP_CONF_', {
  configurable: false,
  writable: false,
});

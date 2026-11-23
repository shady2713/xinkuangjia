/**
 * 开发与部署产物共用的默认运行时公开配置。
 */
window._BASIC_FRAMEWORK_APP_CONF_ = {
  VITE_APP_TITLE: '企业级中后台',
  VITE_GLOB_API_URL: '/admin-api',
  VITE_APP_CAPTCHA_ENABLE: 'true',
};

Object.freeze(window._BASIC_FRAMEWORK_APP_CONF_);
Object.defineProperty(window, '_BASIC_FRAMEWORK_APP_CONF_', {
  configurable: false,
  writable: false,
});

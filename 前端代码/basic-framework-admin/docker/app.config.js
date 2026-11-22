/**
 * 管理平台运行时公开配置（禁止包含任何密码、私钥或 Token）。
 * 生产部署通过覆盖 `_app.config.js` 生效，刷新浏览器即应用。
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

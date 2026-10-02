/**
 * 管理平台运行时配置。
 *
 * 开发环境会直接加载本文件；生产构建会将本文件原样生成到站点根目录的
 * `_app.config.js`，Dockerfile 也会使用本文件覆盖该产物。因此，除本地开发 API 地址外，
 * 所有可运行时调整的应用配置都以本文件为唯一默认值来源。
 *
 * 注意事项：
 * 1. 运行时布尔值统一使用字符串 `'true'` 或 `'false'`；
 * 2. `.env` 只保留 Vite 构建参数；本地开发可用 `VITE_GLOB_API_URL` 覆盖接口地址；
 * 3. 修改配置后需要刷新页面，Nginx 已对 `_app.config.js` 设置禁止缓存；
 * 4. 本文件会发送到浏览器，禁止填写真实密码、私钥、Token 或其他服务端秘密。
 *
 * @author 李杰
 */
window._VBEN_ADMIN_PRO_APP_CONF_ = {
  // ==================== 应用基础信息 ====================

  // 浏览器运行时显示的应用名称；构建阶段的 HTML 标题仍由 .env 中的 VITE_APP_TITLE 提供。
  VITE_APP_TITLE: '管理平台',
  // 应用命名空间；用于隔离 Pinia 等必须保留的业务状态，不用于保存界面偏好。
  VITE_APP_NAMESPACE: 'admin-platform-ele',
  // Pinia 生产持久化的客户端混淆密钥；该值对浏览器可见，不能作为真正的安全密钥。
  VITE_APP_STORE_SECURE_KEY: '',

  // ==================== 接口、认证与登录 ====================

  // 是否显示登录图形验证码；必须与后端验证码开关保持一致。
  VITE_APP_CAPTCHA_ENABLE: 'true',
  // 是否显示页面文档提醒；false 表示隐藏提醒入口。
  VITE_APP_DOCALERT_ENABLE: 'false',
  // 后端 API 前缀；Nginx 会将 `/admin-api` 代理到共用后台容器。
  VITE_GLOB_API_URL: '/admin-api',
  // 钉钉登录客户端 ID；留空时不启用钉钉登录。
  VITE_GLOB_AUTH_DINGDING_CLIENT_ID: '',
  // 钉钉登录企业 ID；留空时不启用钉钉登录。
  VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
  // 登录表单默认账号；仅用于提升开发体验，不要填写真实生产账号。
  VITE_APP_DEFAULT_USERNAME: 'admin',
  // 登录表单默认密码；必须保持为空，避免凭证被打包或发送到浏览器。
  VITE_APP_DEFAULT_PASSWORD: '',

  // ==================== 请求与上传 ====================

  // 是否启用 API 请求加密；启用前必须同时配置下方算法、请求密钥和响应密钥。
  VITE_APP_API_ENCRYPT_ENABLE: 'false',
  // API 加密标识请求头；必须与后端 api-encrypt.header 保持一致。
  VITE_APP_API_ENCRYPT_HEADER: 'X-Api-Encrypt',
  // API 加密算法；当前加解密工具支持 AES 等已实现算法。
  VITE_APP_API_ENCRYPT_ALGORITHM: 'AES',
  // 请求数据加密密钥；会暴露给浏览器，只能作为协议参数，不能代替服务端密钥。
  VITE_APP_API_ENCRYPT_REQUEST_KEY: '',
  // 响应数据解密密钥；会暴露给浏览器，只能作为协议参数，不能代替服务端密钥。
  VITE_APP_API_ENCRYPT_RESPONSE_KEY: '',
  // 文件上传方式：server 由后端接收上传，client 由浏览器使用预签名地址直传。
  VITE_UPLOAD_TYPE: 'server',

  // ==================== 固定界面偏好 ====================

  // 登录页布局：panel-left 左侧、panel-center 居中、panel-right 右侧。
  VITE_APP_AUTH_PAGE_LAYOUT: 'panel-right',
  // 是否显示登录后的偏好设置入口；固定配置模式下保持 false。
  VITE_APP_ENABLE_PREFERENCES: 'false',
  // 是否显示登录后顶部的全局搜索入口；false 时同时隐藏搜索按钮和快捷键提示。
  VITE_APP_GLOBAL_SEARCH_ENABLE: 'false',
  // 内置主题：default 蓝、violet 紫、pink 红、yellow 黄、sky-blue 靛蓝、green 绿、zinc 黑。
  VITE_APP_THEME_BUILTIN_TYPE: 'default',
  // 主题主色；更换内置主题时，应按上方主题名称同步填写对应的 HSL 颜色值。
  VITE_APP_THEME_COLOR_PRIMARY: 'hsl(212 100% 45%)',
  // 明暗模式：light 浅色、dark 深色、auto 跟随操作系统。
  VITE_APP_THEME_MODE: 'light',
  // 是否显示登录后的明暗主题切换；固定配置模式下保持 false。
  VITE_APP_THEME_TOGGLE_ENABLE: 'false',
};

// 配置项均为扁平字符串，浅冻结即可阻止运行期间修改字段值。
Object.freeze(window._VBEN_ADMIN_PRO_APP_CONF_);
// 锁定全局配置引用，防止其他脚本删除、替换或重新定义整个配置对象。
Object.defineProperty(window, '_VBEN_ADMIN_PRO_APP_CONF_', {
  configurable: false, // 禁止删除或重新定义该全局属性。
  writable: false, // 禁止将全局属性替换为其他对象。
});

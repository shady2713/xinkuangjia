/**
 * 应用入口：读取 app.config.js 与偏好覆盖项完成偏好初始化，
 * 再把命名空间交给 bootstrap 启动 Vue 应用，最后移除首屏全局 loading。
 * 应用装配细节在 bootstrap，本文件只管启动顺序与遮罩收尾。
 */
import { initPreferences } from '@vben/preferences';
import { unmountGlobalLoading } from '@vben/utils';

/**
 * 应用初始化完成之后再进行页面加载渲染
 */
async function initApplication() {
  // 生产环境由页面先加载 _app.config.js；开发环境直接复用同一份运行时配置源文件。
  if (!import.meta.env.PROD) {
    await import('../docker/app.config.js');
  }
  const { overridesPreferences } = await import('./preferences');
  const appConfig = window._VBEN_ADMIN_PRO_APP_CONF_;

  // 命名空间用于隔离不同应用必须保留的业务状态，不再用于持久化界面偏好。
  const env = import.meta.env.PROD ? 'prod' : 'dev';
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const namespace = `${appConfig.VITE_APP_NAMESPACE}-${appVersion}-${env}`;

  // app偏好设置初始化
  await initPreferences({
    namespace,
    overrides: overridesPreferences,
  });

  // 启动应用并挂载
  // vue应用主要逻辑及视图
  const { bootstrap } = await import('./bootstrap');
  await bootstrap(namespace);

  // 移除并销毁loading
  unmountGlobalLoading();
}

initApplication();

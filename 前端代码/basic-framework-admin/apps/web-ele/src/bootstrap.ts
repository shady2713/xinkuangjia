import { createApp, watchEffect } from 'vue';

import { registerAccessDirective } from '@vben/access';
import { preferences } from '@vben/preferences';
import { initStores } from '@vben/stores';
import '@vben/styles';
import '@vben/styles/ele';

import { useTitle } from '@vueuse/core';
import { ElLoading } from 'element-plus';

import { $t, setupI18n } from '#/locales';

import { initComponentAdapter } from './adapter/component';
import { initSetupVbenForm } from './adapter/form';
import App from './app.vue';
import { router } from './router';

/**
 * 初始化组件适配器、国际化、状态管理、权限指令与路由并挂载管理后台根组件。
 *
 * @param namespace 本地存储与状态隔离命名空间
 */
async function bootstrap(namespace: string) {
  await initComponentAdapter();
  await initSetupVbenForm();

  const app = createApp(App);
  app.directive('loading', ElLoading.directive);

  await setupI18n(app);
  await initStores(app, { namespace });
  registerAccessDirective(app);

  app.use(router);

  /** 随当前激活路由动态更新浏览器标签页标题。 */
  function syncDocumentTitle() {
    if (preferences.app.dynamicTitle) {
      const routeTitle = router.currentRoute.value.meta?.title;
      const pageTitle =
        (routeTitle ? `${$t(routeTitle)} - ` : '') + preferences.app.name;
      useTitle(pageTitle);
    }
  }
  watchEffect(syncDocumentTitle);

  app.mount('#app');
}

export { bootstrap };

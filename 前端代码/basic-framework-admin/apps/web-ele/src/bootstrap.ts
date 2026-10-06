/**
 * 应用启动编排：在挂载根组件前按序完成组件适配器、表单、国际化、状态库
 * 与路由的初始化，并注册权限指令、加载指令、tippy 与 Motion 插件。
 * 由 main.ts 读取运行环境变量后调用；各能力的实现分散在 adapter、locales、
 * router 等模块，这里只负责调用顺序与挂载时机。
 */
import { createApp, watchEffect } from 'vue';
import VueDOMPurifyHTML from 'vue-dompurify-html';

import { registerAccessDirective } from '@vben/access';
import { registerLoadingDirective } from '@vben/common-ui';
import { preferences } from '@vben/preferences';
import { initStores } from '@vben/stores';
import '@vben/styles';
import '@vben/styles/ele';

import { useTitle } from '@vueuse/core';
import { ElLoading } from 'element-plus';

import { $t, setupI18n } from '#/locales';
import { setupFormCreate } from '#/plugins/form-create';

import { initComponentAdapter } from './adapter/component';
import { initSetupVbenForm } from './adapter/form';
import App from './app.vue';
import { router } from './router';

/**
 * 按顺序完成应用启动装配：初始化组件与表单适配器、国际化、状态库和路由，
 * 注册权限指令、加载指令、tippy 与 Motion 插件，最后把根组件挂载到 #app。
 *
 * 由 main.ts 读取运行环境变量后调用；每一步都是后续步骤的前置条件，
 * 任一初始化失败都会中断启动并以 rejected Promise 交给调用方处理，此时根组件尚未挂载。
 *
 * @param namespace 状态持久化使用的命名空间前缀，多应用共用浏览器存储时用于隔离数据
 * @returns 挂载完成后兑现的 Promise，不携带业务数据
 */
async function bootstrap(namespace: string) {
  // 初始化组件适配器
  await initComponentAdapter();

  // 初始化表单组件
  await initSetupVbenForm();

  // // 设置弹窗的默认配置
  // setDefaultModalProps({
  //   fullscreenButton: false,
  // });
  // // 设置抽屉的默认配置
  // setDefaultDrawerProps({
  //   zIndex: 2000,
  // });
  const app = createApp(App);
  app.use(VueDOMPurifyHTML);
  // 注册Element Plus提供的v-loading指令
  app.directive('loading', ElLoading.directive);

  registerLoadingDirective(app, {
    loading: false,
    spinning: 'spinning',
  });

  // 国际化 i18n 配置
  await setupI18n(app);

  // 配置 pinia-tore
  await initStores(app, { namespace });

  // 安装权限指令
  registerAccessDirective(app);

  // 初始化 tippy
  const { initTippy } = await import('@vben/common-ui/es/tippy');
  initTippy(app);

  // 配置路由及路由守卫
  app.use(router);

  // 配置Motion插件
  const { MotionPlugin } = await import('@vben/plugins/motion');
  app.use(MotionPlugin);

  // formCreate
  setupFormCreate(app);

  // 动态更新标题
  watchEffect(() => {
    if (preferences.app.dynamicTitle) {
      const routeTitle = router.currentRoute.value.meta?.title;
      const pageTitle =
        (routeTitle ? `${$t(routeTitle)} - ` : '') + preferences.app.name;
      useTitle(pageTitle);
    }
  });

  app.mount('#app');
}

export { bootstrap };

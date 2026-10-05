/**
 * 内容区加载动画（use-content-spinner 的 onEnd 二次确认）的真实行为回归。
 *
 * 路由后置守卫调用 onEnd 关闭加载动画前，会再次确认「页面切换动画」偏好是否仍然开启：
 * 用户在导航未结束时关掉该偏好后，onEnd 必须提前返回、不再改动加载态。缺少这次确认时，
 * 一次旧导航会把已经关闭的加载态重新写回，界面出现开关失效的额外闪动。
 * 用例安装真实 vue-router 与真实守卫，导航途中真实改写共享偏好设置，读取的是加载态本身。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { preferencesManager } from '@vben/preferences';

import { afterEach, describe, expect, it } from 'vitest';

import { useContentSpinner } from './use-content-spinner';

/** 路由目标组件：导航只需真实完成，不渲染业务内容。 */
const RouteView = defineComponent({
  name: 'RouteView',
  /** 渲染最小宿主节点，证明路由导航真实落地。 */
  render: () => h('div', { 'data-test': 'route-view' }),
});

/** 最近一次挂载取得的加载态，用来读取真实守卫写入的结果。 */
let spinner: ReturnType<typeof useContentSpinner>;

/**
 * 探针组件：在真实组件上下文内注册路由守卫。
 */
const SpinnerProbe = defineComponent({
  name: 'SpinnerProbe',
  /**
   * 在真实组件上下文内注册路由守卫。
   * @returns 渲染最小宿主节点的渲染函数。
   */
  setup() {
    spinner = useContentSpinner();
    return /** 渲染最小宿主节点，加载态通过模块变量读取。 */ () =>
      h('div', { 'data-test': 'spinner-probe' });
  },
});

describe('内容区加载动画的关闭时机', /** 关闭时机决定用户看到的是正常的加载动画还是开关失效的闪动。 */ () => {
  afterEach(
    /** 恢复被用例改写的过渡偏好，避免影响其他用例。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  it('导航途中关闭过渡偏好后 onEnd 不再改动加载态', /** 偏好已关闭时 onEnd 必须放弃关闭动作，否则旧导航会覆盖用户刚做的设置。 */ async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { component: RouteView, name: 'home', path: '/' },
        { component: RouteView, name: 'page', path: '/page' },
      ],
    });
    await router.push('/');
    await router.isReady();
    const probe = mount(SpinnerProbe, { global: { plugins: [router] } });

    // 导航途中改写偏好：前置守卫拿到真实路由对象，把「内嵌页地址」定义成读取时
    // 关闭过渡动画的属性，模拟用户在导航未结束时关掉「页面切换动画」开关。
    router.beforeEach(
      /** 在被导航到的真实路由对象上安装读取副作用，返回放行结果。
       * @returns 始终放行本次导航。
       */
      (to) => {
        if (to.name === 'page') {
          Object.defineProperty(to.meta, 'iframeSrc', {
            configurable: true,
            /** 读取内嵌地址时关闭过渡动画，随后交回空地址让守卫继续执行。
             * @returns 空字符串，表示该页面不是内嵌页。
             */
            get: () => {
              preferencesManager.updatePreferences({
                transition: { loading: false },
              });
              return '';
            },
          });
        }
        return true;
      },
    );

    await router.push('/page');

    // onEnd 提前返回，加载态保持在导航途中打开的状态，没有被旧导航写回。
    expect(spinner.spinning.value).toBe(true);
    probe.unmount();
  });
});

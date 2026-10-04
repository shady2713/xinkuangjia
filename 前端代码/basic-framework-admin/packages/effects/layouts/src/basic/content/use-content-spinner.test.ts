/**
 * 内容区加载动画（useContentSpinner）的真实行为回归。
 *
 * 组合式函数注册真实路由守卫并把首屏/切换时的加载动画交给 `spinning`：
 * 普通导航必须立刻显示加载态、并在最小显示时间（500ms）到期后才关闭；
 * 已加载页面、内嵌页面和关闭了过渡动画时必须提前返回，不改变加载态。
 * 用例安装真实 vue-router 与真实守卫，断言的是导航过程中可观察到的加载态。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { preferencesManager } from '@vben/preferences';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

/**
 * 创建包含普通页、已加载页与内嵌页的真实内存路由。
 * @returns 可安装到测试应用的真实 router 实例。
 */
function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: RouteView, name: 'home', path: '/' },
      { component: RouteView, name: 'page', path: '/page' },
      {
        component: RouteView,
        meta: { loaded: true, title: '已加载' },
        name: 'loaded',
        path: '/loaded',
      },
      {
        component: RouteView,
        meta: { iframeSrc: 'https://example.test/embed', title: '内嵌页' },
        name: 'iframe',
        path: '/iframe',
      },
      { component: RouteView, name: 'slow', path: '/slow' },
    ],
  });
}

/**
 * 在初始地址完成首次导航后挂载探针，避免守卫注册影响首屏导航。
 * @returns 已完成就绪导航的 router 与已挂载的探针。
 */
async function mountReadyProbe() {
  const router = createTestRouter();
  await router.push('/');
  await router.isReady();
  const probe = mount(SpinnerProbe, { global: { plugins: [router] } });
  return { probe, router };
}

describe('内容区加载动画', /** 加载动画的显示与关闭时机直接决定用户看到卡顿还是白屏闪烁。 */ () => {
  afterEach(
    /** 恢复被用例改写的过渡偏好，避免影响其他用例。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  it('普通导航立即显示加载态并在最小显示时间后关闭', /** 关闭过早会闪烁，关闭过晚会让页面看起来卡住。 */ async () => {
    const { probe, router } = await mountReadyProbe();

    await router.push('/page');
    expect(spinner.spinning.value).toBe(true);

    await vi.waitFor(
      /** 等待最小显示时间到期后加载态必须关闭。 */ () => {
        expect(spinner.spinning.value).toBe(false);
      },
      { timeout: 2000 },
    );

    probe.unmount();
  });

  it('已加载页面不触发加载态', /** 回退到缓存页面不应再次显示加载动画。 */ async () => {
    const { probe, router } = await mountReadyProbe();

    await router.push('/loaded');

    expect(spinner.spinning.value).toBe(false);
    probe.unmount();
  });

  it('内嵌页面不触发加载态', /** iframe 内嵌页由子页面自行加载，外层不应显示加载动画。 */ async () => {
    const { probe, router } = await mountReadyProbe();

    await router.push('/iframe');

    expect(spinner.spinning.value).toBe(false);
    probe.unmount();
  });

  it('关闭过渡偏好后导航不再改变加载态', /** 使用方关闭过渡动画后必须完全不介入导航。 */ async () => {
    const { probe, router } = await mountReadyProbe();
    preferencesManager.updatePreferences({ transition: { loading: false } });

    await router.push('/page');

    expect(spinner.spinning.value).toBe(false);
    probe.unmount();
  });

  it('导航耗时超过最小显示时间时立即关闭', /** 慢导航已经等够了最小时间，再延迟关闭就是多余等待。 */ async () => {
    const { probe, router } = await mountReadyProbe();
    let spinningDuringNavigation: boolean | undefined;

    router.beforeEach(
      /**
       * 用真实耗时越过最小显示时间窗口，并在导航过程中记录加载态。
       * @returns 延迟结束后放行导航。
       */
      async () => {
        await new Promise(
          /** 真实等待 600ms，超过 500ms 的最小显示时间。 */ (resolve) => {
            setTimeout(resolve, 600);
          },
        );
        spinningDuringNavigation = spinner.spinning.value;
        return true;
      },
    );

    await router.push('/slow');

    expect(spinningDuringNavigation).toBe(true);
    expect(spinner.spinning.value).toBe(false);
    probe.unmount();
  });
});

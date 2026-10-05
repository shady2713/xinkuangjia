/**
 * 基础布局内容区（basic/content/content.vue）路由视图装配与缓存行为回归。
 *
 * 该外壳是全部业务页面的落点，它同时决定四件事：路由视图是否渲染、是否套页面切换动画、
 * 是否按标签页白名单缓存页面、内嵌页是否被隐藏。动画开关判断错会让用户在关闭动画后仍看到位移；
 * KeepAlive 白名单与补名逻辑写错会让缓存的页面在切换后丢失已填内容或反复重挂载；
 * 路由缺少视图时若不记录错误，页面会静默空白而无从排查；刷新标签页期间若不停止渲染视图，
 * 用户会看到旧页面残留。用例在真实内存路由与真实 Pinia 标签页 Store 上挂载真实外壳，
 * 只替换外部边界：无。
 */
import type { Router } from 'vue-router';

import { flushPromises, mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';
import { initStores, useTabbarStore } from '@vben/stores';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Content from './content.vue';

/** 各路由视图的真实挂载次数，用来判断 KeepAlive 是否命中缓存。 */
const mountCounts = { cached: 0, other: 0 };

/**
 * 创建一个会记录挂载次数的路由视图。
 * @param name 组件名；省略时返回未命名组件，用于验证外壳按路由名补名。
 * @param testId 渲染节点的定位标识。
 * @param label 渲染文案。
 * @returns 可直接挂到路由上的组件定义。
 */
function createView(name: string | undefined, testId: string, label: string) {
  const options = {
    /**
     * 记录真实挂载次数并渲染可定位节点。
     * @returns 渲染函数。
     */
    setup() {
      if (testId === 'cached-view') {
        mountCounts.cached += 1;
      }
      if (testId === 'other-view') {
        mountCounts.other += 1;
      }
      return /** 渲染用例可定位的视图节点。 */ () =>
        h('div', { 'data-test': testId }, label);
    },
  };
  return name === undefined ? options : { ...options, name };
}

/**
 * 创建带真实路由表的测试路由并导航到指定地址。
 * 每次调用都重新生成视图组件，避免外壳补名对组件对象的改写泄漏到其他用例。
 * @param path 初始导航到的地址。
 * @returns 路由实例、匿名路由视图组件与"组件名与路由名一致"的视图组件。
 */
async function createRouterAt(path: string) {
  const anonymousView = createView(
    undefined,
    'anonymous-view',
    'DUMMY-匿名视图',
  );
  // 组件名与路由名一致的视图：用于验证外壳不会重复改写组件名。
  const sameNameView = createView('OtherView', 'other-view', 'DUMMY-其他视图');
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        component: createView('CachedView', 'cached-view', 'DUMMY-缓存视图'),
        meta: { keepAlive: true, title: 'DUMMY-缓存页' },
        name: 'CachedView',
        path: '/cached',
      },
      {
        component: createView('NamedView', 'named-view', 'DUMMY-已命名视图'),
        name: 'alias-route',
        path: '/named',
      },
      {
        component: anonymousView,
        name: 'anonymous-route',
        path: '/anonymous',
      },
      {
        component: sameNameView,
        name: 'OtherView',
        path: '/other',
      },
      {
        component: createView(
          'IframeRouteView',
          'iframe-route-view',
          'DUMMY-内嵌页外壳',
        ),
        meta: {
          iframeSrc: 'https://example.com/DUMMY-内嵌页',
          title: 'DUMMY-内嵌页',
        },
        name: 'IframeRouteView',
        path: '/iframe',
      },
      {
        component: createView('NoNameView', 'no-name-view', 'DUMMY-无名路由'),
        path: '/no-name',
      },
      {
        // 匹配到记录但没有默认视图：用于验证外壳对缺失视图的错误分支。
        components: {},
        name: 'no-component-route',
        path: '/no-component',
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  return { anonymousView, router, sameNameView };
}

/**
 * 初始化真实 pinia 与标签页商店：内容区外壳通过 storeToRefs 消费真实 store 状态，
 * 因此这里走生产同一条 initStores 初始化链路，而不是替换 store 实现。
 * @returns 已安装持久化插件的真实 pinia 实例。
 */
async function setupStores() {
  (
    window as unknown as {
      /** 应用级配置，持久化插件需要其中的存储密钥。 */
      _VBEN_ADMIN_PRO_APP_CONF_?: Record<string, string>;
    }
  )._VBEN_ADMIN_PRO_APP_CONF_ = {
    VITE_APP_STORE_SECURE_KEY: 'DUMMY-存储密钥',
  };
  return initStores(
    createApp({
      /** 空应用只用于安装 pinia，不渲染界面。 */
      render: () => null,
    }),
    { namespace: 'DUMMY-内容区测试' },
  );
}

/**
 * 在指定路由上挂载内容区外壳。
 * @param router 已完成就绪导航的真实路由。
 * @param pinia 已初始化的真实 pinia 实例。
 * @returns 已挂载的内容区组件包装器。
 */
function mountContent(
  router: Router,
  pinia: Awaited<ReturnType<typeof setupStores>>,
) {
  return mount(Content, {
    global: { plugins: [router, pinia] },
  });
}

/**
 * 把标签页商店的真实缓存白名单填上指定路由名。
 * @param name 需要进入 KeepAlive 白名单的路由名。
 */
function cacheTab(name: string) {
  useTabbarStore().addTab({
    fullPath: '/cached',
    hash: '',
    matched: [],
    meta: { keepAlive: true, title: 'DUMMY-缓存页' },
    name,
    params: {},
    path: '/cached',
    query: {},
    redirectedFrom: undefined,
  });
}

beforeEach(
  /** 重置偏好设置、挂载计数与标签页商店，避免用例之间互相影响。 */ () => {
    resetPreferences();
    mountCounts.cached = 0;
    mountCounts.other = 0;
  },
);

afterEach(
  /** 恢复默认偏好设置，避免动画与缓存开关泄漏到其他用例。 */ () => {
    resetPreferences();
  },
);

describe('内容区路由视图装配', /** 视图渲染与动画开关错误会让业务页面空白或切换异常。 */ () => {
  it('默认配置下渲染路由视图并套用标签页缓存', /** 缓存白名单内的页面必须被 KeepAlive 接管，否则来回切换会丢失已填内容。 */ async () => {
    const { router } = await createRouterAt('/cached');
    const pinia = await setupStores();
    cacheTab('CachedView');
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(wrapper.get('[data-test="cached-view"]').text()).toBe(
      'DUMMY-缓存视图',
    );
    expect(mountCounts.cached).toBe(1);

    await router.push('/other');
    await flushPromises();
    await router.push('/cached');
    await flushPromises();

    // 命中缓存：回到缓存页不应产生第二次真实挂载。
    expect(mountCounts.cached).toBe(1);
    expect(wrapper.find('[data-test="cached-view"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('关闭页面切换动画后仍然渲染路由视图', /** 关掉动画后视图必须照常出现，不能因为过渡开关而整块不渲染。 */ async () => {
    updatePreferences({ transition: { enable: false } });
    const { router } = await createRouterAt('/other');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(preferences.transition.enable).toBe(false);
    expect(wrapper.get('[data-test="other-view"]').text()).toBe(
      'DUMMY-其他视图',
    );
    wrapper.unmount();
  });

  it('关闭标签页缓存后直接渲染路由组件', /** 关闭缓存后仍走缓存分支会让页面被意外保留，重新进入时看到旧状态。 */ async () => {
    updatePreferences({ tabbar: { keepAlive: false } });
    const { router } = await createRouterAt('/cached');
    const pinia = await setupStores();
    cacheTab('CachedView');
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(wrapper.find('[data-test="cached-view"]').exists()).toBe(true);

    await router.push('/other');
    await flushPromises();
    await router.push('/cached');
    await flushPromises();

    // 缓存关闭：每次进入都会重新挂载，中间真的渲染过一次其他视图。
    expect(mountCounts.cached).toBe(2);
    expect(mountCounts.other).toBe(1);
    wrapper.unmount();
  });

  it('关闭标签页功能后不使用缓存并保留全局动画', /** 标签页关闭时动画必须退回全局配置，否则页面切换会没有过渡或抛错。 */ async () => {
    updatePreferences({ tabbar: { enable: false } });
    const { router } = await createRouterAt('/cached');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(wrapper.find('[data-test="cached-view"]').exists()).toBe(true);
    expect(mountCounts.cached).toBe(1);
    wrapper.unmount();
  });

  it('同时关闭动画与缓存后仍然直接渲染路由组件', /** 两个开关同时关闭时若仍按动画分支渲染，页面切换会卡住或整块空白。 */ async () => {
    updatePreferences({
      tabbar: { keepAlive: false },
      transition: { enable: false },
    });
    const { router } = await createRouterAt('/cached');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(wrapper.get('[data-test="cached-view"]').text()).toBe(
      'DUMMY-缓存视图',
    );
    expect(mountCounts.cached).toBe(1);
    wrapper.unmount();
  });
});

describe('内容区路由视图补名与异常分支', /** 补名与异常处理错误会让缓存索引错位或页面静默空白。 */ () => {
  it('未命名的路由视图按路由名补名', /** 组件缺少 name 会让 KeepAlive 与标签页缓存都无法按名索引，缓存整体失效。 */ async () => {
    const { anonymousView, router } = await createRouterAt('/anonymous');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(wrapper.find('[data-test="anonymous-view"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'anonymous-route' }).exists()).toBe(
      true,
    );
    expect((anonymousView as { name?: string }).name).toBe('anonymous-route');
    wrapper.unmount();
  });

  it('已命名的路由视图保持自身组件名', /** 覆盖组件原有 name 会让缓存白名单失配，页面反复重挂载。 */ async () => {
    const { router } = await createRouterAt('/named');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    // 路由名与组件名不同：补名逻辑必须保留组件自己的名字。
    expect(wrapper.findComponent({ name: 'NamedView' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'alias-route' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('路由没有名称时原样渲染视图', /** 无名路由没有可用于补名的名字，强行补名会让缓存键变成 undefined。 */ async () => {
    const { router } = await createRouterAt('/no-name');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(wrapper.get('[data-test="no-name-view"]').text()).toBe(
      'DUMMY-无名路由',
    );
    wrapper.unmount();
  });

  it('组件名与路由名一致时不再改写组件名', /** 同名改写会让缓存索引与组件实际名字错位，页面反复重挂载。 */ async () => {
    const { router, sameNameView } = await createRouterAt('/other');
    const pinia = await setupStores();
    // 用访问器记录组件名的改写：同名时外壳必须直接返回，不能写入 name。
    const declaredName = (sameNameView as { name?: string }).name;
    const nameWrites: unknown[] = [];
    Object.defineProperty(sameNameView, 'name', {
      configurable: true,
      /** 读取组件声明的名字，供外壳判定是否已命名。 */
      get: () => declaredName,
      /** 记录外壳对组件名的改写。 */
      set: (value: unknown) => {
        nameWrites.push(value);
      },
    });

    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(wrapper.find('[data-test="other-view"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'OtherView' }).exists()).toBe(true);
    // 同名早退必须真实发生：组件名一次都没有被改写。
    expect(nameWrites).toEqual([]);
    wrapper.unmount();
  });

  it('路由缺少视图组件时记录错误且不渲染内容', /** 静默空白会让配置错误无法定位，必须留下可检索的错误日志。 */ async () => {
    const consoleError = vi.spyOn(console, 'error');
    consoleError.mockImplementation(
      /** 拦截真实错误日志，既避免污染输出又能核对日志内容。 */ () => {},
    );
    const { router } = await createRouterAt('/no-component');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith(
      'Component view not found，please check the route configuration',
    );
    expect(wrapper.find('[data-test="cached-view"]').exists()).toBe(false);
    consoleError.mockRestore();
    wrapper.unmount();
  });

  it('内嵌页路由通过 v-show 隐藏外壳内的视图', /** 内嵌页与普通页共用外壳，忘记隐藏会让两套内容同时显示。 */ async () => {
    const { router } = await createRouterAt('/iframe');
    const pinia = await setupStores();
    const wrapper = mountContent(router, pinia);
    await flushPromises();

    const view = wrapper.get('[data-test="iframe-route-view"]');
    expect(view.attributes('style')).toContain('display: none');
    // v-show 只隐藏不销毁：内嵌页切换回来时不能重新挂载 iframe。
    expect(view.text()).toBe('DUMMY-内嵌页外壳');
    wrapper.unmount();
  });
});

describe('内容区刷新标签页', /** 刷新依赖渲染开关与缓存排除表的真实联动。 */ () => {
  it('刷新标签页期间停止渲染视图，结束后恢复', /** 刷新期间不停渲染会让用户看到旧页面，恢复失败会让页面永久空白。 */ async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { router } = await createRouterAt('/cached');
    const pinia = await setupStores();
    cacheTab('CachedView');
    const wrapper = mountContent(router, pinia);
    await flushPromises();
    expect(wrapper.find('[data-test="cached-view"]').exists()).toBe(true);

    const refreshing = useTabbarStore().refresh(router);
    await nextTick();

    // 刷新期间 renderRouteView 为 false，同时当前标签页被加入缓存排除表。
    expect(wrapper.find('[data-test="cached-view"]').exists()).toBe(false);
    expect(useTabbarStore().getExcludeCachedTabs).toContain('CachedView');

    await vi.advanceTimersByTimeAsync(200);
    await refreshing;
    await flushPromises();

    expect(wrapper.find('[data-test="cached-view"]').exists()).toBe(true);
    expect(useTabbarStore().getExcludeCachedTabs).toStrictEqual([]);
    vi.useRealTimers();
    wrapper.unmount();
  });
});

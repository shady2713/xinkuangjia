/**
 * 内嵌页路由视图（iframe/iframe-router-view.vue）真实内嵌视图切换回归。
 *
 * 该组件按真实标签页数据为每个内嵌菜单保活一个 iframe，并只让当前路由对应的那个可见：漏渲染会
 * 让用户打开内嵌菜单看到空白，多个 iframe 同时可见会让页面叠在一起，切换路由时不隐藏旧视图会
 * 让内容串台，重复加载指示器复位失效则会让遮罩永久挡住页面。用例使用真实 Pinia 标签页 store、
 * 真实内存路由与真实偏好开关，断言真实 iframe 的 src、可见性与真实加载状态变化。
 */
import { mount } from '@vue/test-utils';
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { preferencesManager } from '@vben/preferences';
import { initStores, useTabbarStore } from '@vben/stores';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IFrameRouterView from './iframe-router-view.vue';

vi.hoisted(
  /**
   * `initStores` 读取运行时配置里的持久化密钥，测试进程没有加载生产配置脚本，
   * 因此在导入 Stores 之前建立最小替身；该键值不参与任何真实加密。
   */
  () => {
    vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
      VITE_APP_STORE_SECURE_KEY: '',
    });
  },
);

/** 与挂载组件共享的 Pinia 实例类型，取自真实初始化入口，避免新增 pinia 类型依赖。 */
type PiniaInstance = Awaited<ReturnType<typeof initStores>>;

/** 用例共享的真实路由实例。 */
let router: ReturnType<typeof createRouter>;
/** 用例共享的真实标签页 store。 */
let tabbarStore: ReturnType<typeof useTabbarStore>;
/** 与挂载组件共享的 Pinia 实例。 */
let pinia: PiniaInstance;
/** 用例挂载的宿主，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

/**
 * 构造真实路由表：两个内嵌页（一个保活、一个不保活）与一个普通页面。
 * @returns 可供内存路由使用的路由记录数组。
 */
function createRoutes() {
  return [
    {
      component: {
        /** 路由视图不参与渲染，用例只关心内嵌视图本身。 */
        render: () => null,
      },
      meta: {
        iframeSrc: 'https://inner.example.test/keep',
        keepAlive: true,
        title: '内嵌保活页',
      },
      name: 'IframeKeep',
      path: '/iframe-keep',
    },
    {
      component: {
        /** 路由视图不参与渲染。 */
        render: () => null,
      },
      meta: {
        iframeSrc: 'https://inner.example.test/plain',
        title: '内嵌普通页',
      },
      name: 'IframePlain',
      path: '/iframe-plain',
    },
    {
      component: {
        /** 路由视图不参与渲染。 */
        render: () => null,
      },
      meta: { title: '普通页' },
      name: 'Plain',
      path: '/plain',
    },
  ];
}

/**
 * 把真实路由登记成标签页。
 * @param paths 需要登记为标签页的真实路由路径，按调用顺序写入访问历史。
 */
function openTabs(...paths: string[]) {
  for (const path of paths) {
    tabbarStore.addTab(router.resolve(path) as never);
  }
}

/**
 * 读取宿主里真实渲染的内嵌视图容器。
 * @param wrapper 已挂载的内嵌视图宿主。
 * @returns 按渲染顺序排列的容器元素数组。
 */
function iframeContainers(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('.relative.size-full')
    .map(/** 取出容器真实 DOM 元素。 */ (node) => node.element as HTMLElement);
}

/**
 * 读取当前真实可见的 iframe 地址。
 * @param wrapper 已挂载的内嵌视图宿主。
 * @returns 可见 iframe 的 src 数组，不可见的视图不计入。
 */
function visibleSrcs(wrapper: ReturnType<typeof mount>) {
  return iframeContainers(wrapper)
    .filter(
      /** 只保留没有被 v-show 隐藏的容器。 */ (container) =>
        container.style.display !== 'none',
    )
    .map(
      /** 取出该容器里 iframe 的真实 src。 */ (container) =>
        container.querySelector('iframe')?.getAttribute('src') ?? '',
    );
}

/**
 * 读取当前真实可见的加载遮罩数量。
 * @param wrapper 已挂载的内嵌视图宿主。
 * @returns 未被隐藏的遮罩元素数量。
 */
function visibleSpinners(wrapper: ReturnType<typeof mount>) {
  return iframeContainers(wrapper).filter(
    /** 遮罩未标记 invisible 时说明它正在展示加载状态。 */ (container) =>
      !container
        .querySelector('.flex-center.z-100')
        ?.className.includes('invisible'),
  ).length;
}

/**
 * 读取宿主里真实渲染的 iframe 元素。
 * @param wrapper 已挂载的内嵌视图宿主。
 * @returns 按渲染顺序排列的 iframe 元素数组。
 */
function iframes(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('iframe')
    .map(
      /** 取出 iframe 真实 DOM 元素。 */ (node) => node.element as HTMLElement,
    );
}

beforeEach(
  /** 每例建立独立真实路由、标签页 store 与偏好状态。 */ async () => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    preferencesManager.resetPreferences();
    pinia = await initStores(
      createApp({
        /** 只为安装 Pinia 提供应用实例，不渲染任何界面。 */
        render: () => null,
      }),
      { namespace: 'iframe-router-view-test' },
    );
    tabbarStore = useTabbarStore(pinia);
    router = createRouter({
      history: createMemoryHistory(),
      routes: createRoutes(),
    });
    await router.push('/iframe-keep');
    await router.isReady();
  },
);

afterEach(
  /** 卸载宿主并复位标签栏开关，避免跨用例污染。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    preferencesManager.resetPreferences();
  },
);

describe('标签栏关闭时的内嵌视图', /** 单页模式必须只跟随当前路由渲染内嵌视图。 */ () => {
  it('路由带内嵌地址时渲染 iframe 并真实可见', /** 漏渲染会让内嵌菜单打开后一片空白。 */ async () => {
    preferencesManager.updatePreferences({ tabbar: { enable: false } });
    mounted = mount(IFrameRouterView, { global: { plugins: [pinia, router] } });

    const frames = iframes(mounted);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute('src')).toBe(
      'https://inner.example.test/keep',
    );
    expect(visibleSrcs(mounted)).toEqual(['https://inner.example.test/keep']);
  });

  it('路由不带内嵌地址时不渲染任何 iframe', /** 普通页面渲染出 iframe 会把页面内容替换成空白内嵌页。 */ async () => {
    preferencesManager.updatePreferences({ tabbar: { enable: false } });
    await router.push('/plain');
    mounted = mount(IFrameRouterView, { global: { plugins: [pinia, router] } });

    expect(iframes(mounted)).toHaveLength(0);
    expect(visibleSrcs(mounted)).toEqual([]);
  });
});

describe('标签栏开启时的内嵌视图', /** 多标签模式必须只为内嵌标签保活视图。 */ () => {
  it('按真实标签数据渲染每个内嵌标签且只显示当前标签', /** 多视图同时可见会让页面叠在一起。 */ async () => {
    openTabs('/iframe-keep', '/iframe-plain', '/plain');
    await router.push('/iframe-plain');
    mounted = mount(IFrameRouterView, { global: { plugins: [pinia, router] } });

    const srcs = iframes(mounted).map(
      /** 收集每个内嵌视图的真实地址。 */ (frame) => frame.getAttribute('src'),
    );
    expect(srcs).toEqual([
      'https://inner.example.test/keep',
      'https://inner.example.test/plain',
    ]);
    // 普通标签页不产生内嵌视图。
    expect(visibleSrcs(mounted)).toEqual(['https://inner.example.test/plain']);
  });

  it('切换回保活标签时恢复显示原视图', /** 切换不还原可见性会让用户点回标签却看不到内容。 */ async () => {
    openTabs('/iframe-keep', '/iframe-plain');
    await router.push('/iframe-plain');
    mounted = mount(IFrameRouterView, { global: { plugins: [pinia, router] } });
    expect(visibleSrcs(mounted)).toEqual(['https://inner.example.test/plain']);

    await router.push('/iframe-keep');

    await vi.waitFor(
      /** 等待路由切换驱动真实可见性更新。 */ () => {
        if (!mounted) {
          throw new Error('内嵌视图宿主尚未挂载');
        }
        expect(visibleSrcs(mounted)).toEqual([
          'https://inner.example.test/keep',
        ]);
      },
      { timeout: 2000 },
    );
  });

  it('离开非保活内嵌标签后隐藏但保留视图', /** 隐藏失效会让旧内嵌页盖住当前页面。 */ async () => {
    openTabs('/iframe-keep', '/iframe-plain');
    await router.push('/iframe-plain');
    mounted = mount(IFrameRouterView, { global: { plugins: [pinia, router] } });

    await router.push('/plain');

    await vi.waitFor(
      /** 等待普通页面下所有内嵌视图都被隐藏。 */ () => {
        if (!mounted) {
          throw new Error('内嵌视图宿主尚未挂载');
        }
        expect(visibleSrcs(mounted)).toEqual([]);
      },
      { timeout: 2000 },
    );
    // 非保活视图被卸载，保活视图保留在标签里。
    expect(iframes(mounted)).toHaveLength(1);
    expect(iframes(mounted)[0]?.getAttribute('src')).toBe(
      'https://inner.example.test/keep',
    );
  });
});

describe('内嵌视图渲染开关', /** 标签页刷新期间必须真实卸载视图。 */ () => {
  it('renderRouteView 关闭时不渲染内嵌视图', /** 刷新期间不卸载会让刷新看不到任何重建效果。 */ async () => {
    openTabs('/iframe-keep');
    tabbarStore.renderRouteView = false;
    mounted = mount(IFrameRouterView, { global: { plugins: [pinia, router] } });

    expect(iframes(mounted)).toHaveLength(0);
  });

  it('renderRouteView 重新打开后内嵌视图恢复渲染', /** 开关恢复失效会让刷新后的页面永久空白。 */ async () => {
    openTabs('/iframe-keep');
    tabbarStore.renderRouteView = false;
    mounted = mount(IFrameRouterView, { global: { plugins: [pinia, router] } });
    expect(iframes(mounted)).toHaveLength(0);

    tabbarStore.renderRouteView = true;

    await vi.waitFor(
      /** 等待真实渲染恢复。 */ () => {
        if (!mounted) {
          throw new Error('内嵌视图宿主尚未挂载');
        }
        expect(iframes(mounted)).toHaveLength(1);
      },
      { timeout: 2000 },
    );
  });
});

describe('内嵌视图加载状态', /** 遮罩不复位会永久挡住内嵌页面。 */ () => {
  it('首次加载显示遮罩并在 iframe 加载完成后收起', /** 加载指示器不复位会让用户以为页面一直卡住。 */ async () => {
    vi.useFakeTimers();
    try {
      preferencesManager.updatePreferences({ tabbar: { enable: false } });
      mounted = mount(IFrameRouterView, {
        global: { plugins: [pinia, router] },
      });

      // 首次加载的 spinning 为真，遮罩在最小加载时间后真实展示。
      await vi.advanceTimersByTimeAsync(80);
      expect(visibleSpinners(mounted)).toBe(1);

      iframes(mounted)[0]?.dispatchEvent(new Event('load'));
      await vi.advanceTimersByTimeAsync(80);

      expect(visibleSpinners(mounted)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('离开非保活内嵌页再回来时重建视图并重新显示遮罩', /** 保活判定写错会让非保活页面残留或二次进入没有加载提示。 */ async () => {
    vi.useFakeTimers();
    try {
      openTabs('/iframe-keep', '/iframe-plain');
      await router.push('/iframe-plain');
      mounted = mount(IFrameRouterView, {
        global: { plugins: [pinia, router] },
      });
      await vi.advanceTimersByTimeAsync(80);
      expect(iframes(mounted)).toHaveLength(2);

      // 切到保活标签：不保活的内嵌视图被真实卸载。
      await router.push('/iframe-keep');
      await vi.advanceTimersByTimeAsync(80);
      expect(iframes(mounted)).toHaveLength(1);
      expect(iframes(mounted)[0]?.getAttribute('src')).toBe(
        'https://inner.example.test/keep',
      );

      // 回到不保活标签：视图重新挂载，并且因为从未加载过而重新显示遮罩。
      await router.push('/iframe-plain');
      await vi.advanceTimersByTimeAsync(80);
      expect(iframes(mounted)[1]?.getAttribute('src')).toBe(
        'https://inner.example.test/plain',
      );
      expect(visibleSpinners(mounted)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

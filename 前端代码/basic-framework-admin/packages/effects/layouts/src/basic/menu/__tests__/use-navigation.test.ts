/**
 * 侧边菜单导航（layouts 的 basic/menu/use-navigation）真实行为回归。
 *
 * 该 composable 决定点击菜单后是站内跳转、新窗口打开外链，还是按路由元信息新开窗口：
 * 分支判错会让外链在应用内打开、带查询参数的目标丢失筛选条件，路由表刷新写错则会让
 * 后注册的菜单永远按旧映射判定。用例在真实 vue-router 内存路由上调用真实 composable，
 * 只替换浏览器窗口打开动作，用真实路由状态与窗口调用记录断言行为。
 */
import type { RouteRecordRaw } from 'vue-router';

import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNavigation } from '../use-navigation';

/** 浏览器窗口打开动作的记录型替身；模块替身与用例读取同一实例。 */
const windowMocks = vi.hoisted(
  /** 建立用例可清空、可断言的窗口动作记录容器。 */ () => ({
    openRouteInNewWindow: vi.fn(),
    openWindow: vi.fn(),
  }),
);

vi.mock(
  '@vben/utils',
  /**
   * 只替换浏览器窗口打开动作，URL 判定与路由解析保持真实实现。
   * @param importOriginal 原始模块加载器，用于取回未替换的实现。
   * @returns 合并后的模块替身，窗口动作替换为可断言的记录函数。
   */
  async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vben/utils')>();
    return { ...actual, ...windowMocks };
  },
);

/** 捕获被测 composable 的返回值，供用例在组件外驱动。 */
let navigation: ReturnType<typeof useNavigation> | undefined;

/** 供断言的外链打开动作记录。 */
const openWindowMock = windowMocks.openWindow;
/** 供断言的按路由新开窗口动作记录。 */
const openRouteMock = windowMocks.openRouteInNewWindow;

/**
 * 建立带元信息的路由表，覆盖站内、外链、新窗口与带查询参数四种目标。
 * @returns 可供内存路由使用的路由记录数组。
 */
function createRoutes(): RouteRecordRaw[] {
  return [
    { component: { name: 'HomeView' }, name: 'Home', path: '/' },
    { component: { name: 'PlainView' }, name: 'Plain', path: '/plain' },
    {
      component: { name: 'QueryView' },
      meta: { query: { id: '7' }, title: '查询页' },
      name: 'WithQuery',
      path: '/with-query',
    },
    {
      component: { name: 'LinkView' },
      meta: { link: 'https://docs.example.test/guide', title: '外链页' },
      name: 'ExternalLink',
      path: '/external-link',
    },
    {
      component: { name: 'NewWindowView' },
      meta: { openInNewWindow: true, title: '新窗口页' },
      name: 'NewWindow',
      path: '/new-window',
    },
  ];
}

/**
 * 在真实路由上下文中调用被测 composable 的宿主组件。
 * @returns 渲染占位节点的组件定义。
 */
function createHost() {
  return defineComponent({
    name: 'NavigationHost',
    /** 在真实组件 setup 中取得导航能力并记录返回值。
     * @returns 渲染占位节点的渲染函数。
     */
    setup() {
      navigation = useNavigation();
      return /** 渲染可定位节点，证明 setup 已在真实渲染中执行。 */ () =>
        h('div', { class: 'navigation-host' });
    },
  });
}

/**
 * 建立内存路由并挂载宿主组件，得到已就绪的被测 composable。
 * @returns 真实内存路由实例，用于断言站内跳转结果。
 */
async function mountNavigation() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: createRoutes(),
  });
  await router.push('/');
  await router.isReady();

  const wrapper = mount(createHost(), { global: { plugins: [router] } });
  if (!navigation) {
    throw new Error('宿主组件未取得导航能力');
  }
  return { router, wrapper };
}

beforeEach(
  /** 每例清空窗口动作记录，避免上一例的调用影响断言。 */ () => {
    vi.clearAllMocks();
    navigation = undefined;
  },
);

describe('willOpenedByWindow 判定是否新开窗口', /** 判定结果直接决定点击菜单是站内跳转还是新开窗口。 */ () => {
  it('未登记的 HTTP 地址一律新开窗口', /** 外链不能占用当前应用的标签页。 */ async () => {
    const { wrapper } = await mountNavigation();

    expect(navigation?.willOpenedByWindow('https://example.test/page')).toBe(
      true,
    );
    wrapper.unmount();
  });

  it('路由元信息声明外链时新开窗口', /** 后端菜单用 link 表达外链，漏判会让外链在应用内打开并报 404。 */ async () => {
    const { wrapper } = await mountNavigation();

    expect(navigation?.willOpenedByWindow('/external-link')).toBe(true);
    wrapper.unmount();
  });

  it('路由元信息声明新窗口时新开窗口', /** openInNewWindow 是后端的显式诉求，不能按普通站内跳转处理。 */ async () => {
    const { wrapper } = await mountNavigation();

    expect(navigation?.willOpenedByWindow('/new-window')).toBe(true);
    wrapper.unmount();
  });

  it('普通站内路由不新开窗口', /** 负对照：普通菜单必须在当前标签页内跳转。 */ async () => {
    const { wrapper } = await mountNavigation();

    expect(navigation?.willOpenedByWindow('/plain')).toBe(false);
    wrapper.unmount();
  });

  it('未登记的路由不新开窗口', /** 找不到路由时不能凭空判定为外链。 */ async () => {
    const { wrapper } = await mountNavigation();

    expect(navigation?.willOpenedByWindow('/not-registered')).toBe(false);
    wrapper.unmount();
  });
});

describe('navigation 执行导航动作', /** 四类目标的分派与查询参数传递是菜单可用性的直接来源。 */ () => {
  it('站内路由在当前标签页内跳转', /** 普通菜单必须改变真实路由状态而不是打开新窗口。 */ async () => {
    const { router, wrapper } = await mountNavigation();

    await navigation?.navigation('/plain');

    expect(router.currentRoute.value.path).toBe('/plain');
    expect(openWindowMock).not.toHaveBeenCalled();
    expect(openRouteMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('站内跳转携带路由元信息中的查询参数', /** 查询参数丢失会让目标页面丢掉筛选条件或详情编号。 */ async () => {
    const { router, wrapper } = await mountNavigation();

    await navigation?.navigation('/with-query');

    expect(router.currentRoute.value.fullPath).toBe('/with-query?id=7');
    wrapper.unmount();
  });

  it('路由元信息的外链地址在新窗口打开', /** 外链地址必须取自元信息而不是当前路径。 */ async () => {
    const { router, wrapper } = await mountNavigation();

    await navigation?.navigation('/external-link');

    expect(openWindowMock).toHaveBeenCalledWith(
      'https://docs.example.test/guide',
      { target: '_blank' },
    );
    expect(router.currentRoute.value.path).toBe('/');
    wrapper.unmount();
  });

  it('未登记的 HTTP 地址直接在新窗口打开', /** 未登记为路由的外链也要能被菜单打开。 */ async () => {
    const { router, wrapper } = await mountNavigation();

    await navigation?.navigation('https://example.test/page');

    expect(openWindowMock).toHaveBeenCalledWith('https://example.test/page', {
      target: '_blank',
    });
    expect(router.currentRoute.value.path).toBe('/');
    wrapper.unmount();
  });

  it('声明新窗口的路由按解析后的地址新开窗口', /** 解析结果与当前应用基路径相关，写错会打开错误地址。 */ async () => {
    const { router, wrapper } = await mountNavigation();

    await navigation?.navigation('/new-window');

    expect(openRouteMock).toHaveBeenCalledWith(
      router.resolve('/new-window').href,
    );
    expect(router.currentRoute.value.path).toBe('/');
    wrapper.unmount();
  });

  it('跳转失败时留痕并向调用方抛出原错误', /** 静默失败会让菜单点击没有任何反馈，调用方也无法补偿。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 屏蔽预期内的输出，只保留调用记录。 */ () => {});
    const { router, wrapper } = await mountNavigation();
    const failure = new Error('路由跳转被拒绝');
    vi.spyOn(router, 'push').mockRejectedValue(failure);

    await expect(navigation?.navigation('/plain')).rejects.toBe(failure);
    expect(consoleError).toHaveBeenCalledWith('Navigation failed:', failure);
    wrapper.unmount();
  });
});

describe('路由映射刷新', /** 动态注册的菜单必须能被后续判定识别，否则新菜单会被当成外链或找不到路由。 */ () => {
  it('完成一次导航后重新收集路由表', /** afterEach 刷新写错会让运行期新增的路由永远停留在旧映射。 */ async () => {
    const { router, wrapper } = await mountNavigation();
    expect(navigation?.willOpenedByWindow('/late-route')).toBe(false);

    router.addRoute({
      component: { name: 'LateView' },
      meta: { openInNewWindow: true, title: '后注册页' },
      name: 'LateRoute',
      path: '/late-route',
    });
    await navigation?.navigation('/plain');

    expect(navigation?.willOpenedByWindow('/late-route')).toBe(true);
    wrapper.unmount();
  });
});

/**
 * 标签页操作 composable（@vben/hooks 的 use-tabs）真实行为回归。
 *
 * `useTabs` 是页面与标签页 store 之间的唯一适配层：每个方法都要把"显式传入的标签页"
 * 或"当前路由"交给真实 store。用例用真实 Vue Router（内存历史）与真实 Pinia store，
 * 在真实组件上下文里调用 composable，然后断言 store 的真实状态变化（关闭结果、固定标记、
 * 标题、刷新期间的路由排除集合）与禁用状态计算结果，而不是断言调用次数。
 *
 * 刷新用例按真实协议断言"刷新期间当前路由被排除缓存、结束后恢复"，这是该 composable 之外
 * 观察不到的唯一窗口，因此不等待固定休眠，而是先读中间状态再等待完成。
 */

import type { Router } from 'vue-router';

import type { RouteMeta, TabDefinition } from '@vben/types';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { initStores, useTabbarStore } from '@vben/stores';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTabs } from '../use-tabs';

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

/**
 * 取出数组中指定位置的元素。
 * @param items 目标数组。
 * @param index 目标下标，从 0 开始。
 * @returns 该下标上的元素。
 * @throws 下标越界时抛出，避免断言作用在 undefined 上。
 */
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`集合下标 ${index} 不存在`);
  }
  return item;
}

/** 用例可覆盖的标签页字段；meta 只写关心的键。 */
type TabOverrides = Omit<Partial<TabDefinition>, 'meta'> & {
  meta?: Partial<RouteMeta>;
};

/** 进入用例前的 store 标签页路径清单，用于断言关闭与固定后的真实顺序。 */
let store: ReturnType<typeof useTabbarStore>;
/** 真实路由实例；内存历史保证用例之间互不干扰。 */
let router: Router;
/** 与挂载组件共享的 Pinia 实例类型，取自真实初始化入口，避免新增 pinia 类型依赖。 */
type PiniaInstance = Awaited<ReturnType<typeof initStores>>;
/** 与挂载组件共享的 Pinia 实例，确保 store 与 composable 看到同一份状态。 */
let pinia: PiniaInstance;
/** 被挂载的宿主组件，用例结束时统一卸载。 */
let wrapper: ReturnType<typeof mount> | undefined;

/**
 * 构造标签页对象。
 * @param path 路由路径，必须是本文件路由表里已声明的路径。
 * @param overrides 需要覆盖的字段，meta 会与路由记录的 meta 合并。
 * @returns 可直接交给 store 的完整标签页。
 */
function tabOf(path: string, overrides: TabOverrides = {}): TabDefinition {
  const resolved = router.resolve(path);
  const { meta, ...rest } = overrides;
  return {
    ...resolved,
    ...rest,
    // 先合并路由与覆盖项，再补默认标题，避免显式属性被后续展开覆盖。
    meta: {
      ...resolved.meta,
      ...meta,
      title: meta?.title ?? resolved.meta.title ?? '',
    },
  } as TabDefinition;
}

/**
 * 用真实 store 的 addTab 打开若干标签页，使访问历史与缓存状态与生产一致。
 * @param paths 需要打开的路径列表，按调用顺序写入访问历史。
 */
function openTabs(...paths: string[]) {
  for (const path of paths) {
    store.addTab(tabOf(path));
  }
}

/** 取出用户可见的标签页路径顺序，固定标签页按真实 getter 排在最前。 */
function visiblePaths() {
  return store.getTabs.map(
    /** 断言只关心路径，避免把内部对象差异带进比较。 */ (tab) => tab.path,
  );
}

/**
 * 在真实组件上下文里调用目标 composable。
 * @returns composable 暴露的标签页操作方法。
 * @throws setup 未执行时报告挂载契约变化。
 */
function mountUseTabs() {
  let tabs: ReturnType<typeof useTabs> | undefined;
  wrapper = mount(
    defineComponent({
      /**
       * 在真实 setup 中调用目标 composable 并渲染空节点。
       * @returns 返回渲染空节点的函数。
       */
      setup() {
        tabs = useTabs();
        /**
         * 渲染空节点，composable 的行为由返回值驱动。
         * @returns 空节点。
         */
        function renderStub() {
          return h('div');
        }

        return renderStub;
      },
    }),
    { global: { plugins: [pinia, router] } },
  );
  if (!tabs) {
    throw new Error('组合式函数必须在 setup 中返回标签页操作方法');
  }
  return tabs;
}

beforeEach(
  /** 每例使用独立真实 Pinia 与真实路由，避免状态与导航相互影响。 */ async () => {
    // 标签页 store 的真实持久化落在 sessionStorage，先清空避免上一例的标签页被恢复。
    sessionStorage.clear();
    pinia = await initStores(
      createApp(
        defineComponent({
          /** 只为安装 Pinia 提供应用实例，不渲染任何界面。 */
          render: () => null,
        }),
      ),
      { namespace: 'use-tabs-test' },
    );
    store = useTabbarStore(pinia);
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          component: {
            /** 路由组件不参与渲染。 */
            render: () => null,
          },
          meta: { title: '首页' },
          name: 'Home',
          path: '/home',
        },
        {
          component: {
            /** 路由组件不参与渲染。 */
            render: () => null,
          },
          meta: { title: '列表' },
          name: 'List',
          path: '/list',
        },
        {
          component: {
            /** 路由组件不参与渲染。 */
            render: () => null,
          },
          meta: { title: '详情' },
          name: 'Detail',
          path: '/detail',
        },
      ],
    });
    await router.push('/list');
    await router.isReady();
  },
);

afterEach(
  /** 卸载宿主组件，避免残留的响应式副作用影响后续用例。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
  },
);

describe('useTabs 关闭类操作', /** 关闭结果必须与真实 store 的批量关闭语义一致。 */ () => {
  it('关闭当前标签页左侧的标签页', /** 左侧范围或固定标签保护写错会关掉不该关的标签页。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeLeftTabs();

    // 当前路由是 /list，其左侧只有 /home，且它不是固定标签页。
    expect(visiblePaths()).toEqual(['/list', '/detail']);
  });

  it('传入标签页时按其位置关闭左侧', /** 显式参数被忽略会让右键菜单作用在错误的目标上。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeLeftTabs(tabOf('/detail'));

    expect(visiblePaths()).toEqual(['/detail']);
  });

  it('关闭当前标签页右侧的标签页', /** 右侧范围写错会把当前页及其左侧一并关闭。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeRightTabs();

    expect(visiblePaths()).toEqual(['/home', '/list']);
  });

  it('传入标签页时按其位置关闭右侧', /** 右侧关闭同样必须尊重显式参数。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeRightTabs(tabOf('/list'));

    expect(visiblePaths()).toEqual(['/home', '/list']);
  });

  it('关闭其他标签页时保留当前标签页', /** 误关当前页会让用户丢失正在浏览的页面。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeOtherTabs();

    expect(visiblePaths()).toEqual(['/list']);
  });

  it('关闭全部标签页时保留一个并跳转到它', /** 全部关闭后没有可跳转的标签页会让内容区空白。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeAllTabs();

    expect(visiblePaths()).toEqual(['/home']);
    expect(router.currentRoute.value.path).toBe('/home');
  });

  it('关闭全部标签页时保留固定标签页', /** 固定标签页被一起关掉会破坏用户固定的入口。 */ async () => {
    openTabs('/home', '/list', '/detail');
    at(store.tabs, 0).meta.affixTab = true;
    const tabs = mountUseTabs();

    await tabs.closeAllTabs();

    expect(visiblePaths()).toEqual(['/home']);
  });

  it('关闭非当前标签页时不跳转', /** 关闭后台标签页触发跳转会打断当前操作。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeCurrentTab(tabOf('/detail'));

    expect(visiblePaths()).toEqual(['/home', '/list']);
    expect(router.currentRoute.value.path).toBe('/list');
  });

  it('关闭当前标签页时跳转到最近访问的标签页', /** 关闭当前页后不跳转会让视图停留在已关闭的路由上。 */ async () => {
    openTabs('/home', '/list', '/detail');
    const tabs = mountUseTabs();

    await tabs.closeCurrentTab(tabOf('/list'));

    expect(visiblePaths()).toEqual(['/home', '/detail']);
    // 访问历史开启时（偏好默认值）回到最近访问过的 /detail，而不是位置相邻的 /home。
    expect(router.currentRoute.value.path).toBe('/detail');
  });

  it('只剩一个标签页时拒绝关闭并保留现场', /** 关闭最后一个标签页会让应用失去可停留的页面。 */ async () => {
    openTabs('/list');
    const tabs = mountUseTabs();
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 静默预期内的输出，避免污染测试结果。 */ () => {});

    await tabs.closeCurrentTab();

    expect(visiblePaths()).toEqual(['/list']);
    expect(error).toHaveBeenCalledWith(
      'Failed to close the tab; only one tab remains open.',
    );

    error.mockRestore();
  });

  it('按编码后的 key 关闭标签页', /** key 未解码会找不到目标，右键菜单关闭失效。 */ async () => {
    openTabs('/home', '/list');
    store.addTab(tabOf('/detail?name=中文'));
    const tabs = mountUseTabs();

    await tabs.closeTabByKey('/detail?name=%E4%B8%AD%E6%96%87');

    expect(visiblePaths()).toEqual(['/home', '/list']);
  });

  it('key 不存在时不改变标签页集合', /** 失效 key 被当成关闭全部会误删标签页。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();

    await tabs.closeTabByKey('/not-exists');

    expect(visiblePaths()).toEqual(['/home', '/list']);
  });
});

describe('useTabs 固定与标题操作', /** 固定标记与标题必须落到真实标签页对象上。 */ () => {
  it('固定标签页时标记并前置', /** 固定后不排序会让固定标签页散落在普通标签页之间。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();

    await tabs.pinTab(tabOf('/list'));

    expect(visiblePaths()).toEqual(['/list', '/home']);
    expect(
      store.affixTabs.map(/** 固定集合只关心路径。 */ (tab) => tab.path),
    ).toEqual(['/list']);
  });

  it('取消固定标签页时清除标记', /** 取消固定后标记残留会让标签页无法被关闭。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();
    await tabs.pinTab(tabOf('/list'));

    await tabs.unpinTab(tabOf('/list'));

    expect(store.affixTabs).toEqual([]);
    expect(at(store.tabs, 0).meta.affixTab).toBe(false);
  });

  it('切换固定状态时按当前标记取反', /** 切换逻辑写反会让固定按钮永远只做一件事。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();

    await tabs.toggleTabPin(tabOf('/list'));
    expect(
      store.affixTabs.map(/** 固定集合只关心路径。 */ (tab) => tab.path),
    ).toEqual(['/list']);

    await tabs.toggleTabPin(at(store.getTabs, 0));
    expect(store.affixTabs).toEqual([]);
  });

  it('设置与重置标签页标题', /** 标题不写入或重置不生效会让多语言标题一直停留在旧值。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();
    store.updateTime = 0;

    await tabs.setTabTitle('新的标题');

    const listTab = store.tabs.find(
      /** 只取当前路由对应的标签页。 */ (tab) => tab.path === '/list',
    );
    expect(listTab?.meta.newTabTitle).toBe('新的标题');
    expect(store.updateTime).toBeGreaterThan(0);

    await tabs.resetTabTitle();

    expect(listTab?.meta.newTabTitle).toBeUndefined();
  });

  it('未传标签页时使用当前路由', /** 未传参时丢失路由会让固定与标题作用到错误的标签页。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();

    await tabs.pinTab();
    await tabs.setTabTitle('路由标题');

    const listTab = store.tabs.find(
      /** 只取当前路由对应的标签页。 */ (tab) => tab.path === '/list',
    );
    expect(listTab?.meta.affixTab).toBe(true);
    expect(listTab?.meta.newTabTitle).toBe('路由标题');
  });
});

describe('useTabs 刷新与新窗口', /** 刷新协议与新窗口地址必须可外部观察。 */ () => {
  it('刷新当前路由时按真实协议排除并恢复缓存', /** 刷新期间不排除缓存会让页面无法真正重新挂载。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();

    const pending = tabs.refreshTab();

    expect(store.getExcludeCachedTabs).toContain('List');
    expect(store.renderRouteView).toBe(false);

    await pending;

    expect(store.getExcludeCachedTabs).not.toContain('List');
    expect(store.renderRouteView).toBe(true);
  });

  it('按名称刷新指定标签页', /** 名称分支写错会让右键刷新作用到当前路由而不是目标标签页。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();

    const pending = tabs.refreshTab('Home');

    expect(store.getExcludeCachedTabs).toContain('Home');

    await pending;

    expect(store.getExcludeCachedTabs).not.toContain('Home');
  });

  it('在新窗口按真实地址协议打开标签页', /** 地址或窗口特性写错会让新窗口被浏览器拦截或打开错误页面。 */ async () => {
    openTabs('/home', '/list');
    const tabs = mountUseTabs();
    const open = vi
      .spyOn(window, 'open')
      .mockImplementation(
        /** 伪 DOM 不提供真实窗口，只记录打开参数。 */ () => null,
      );

    await tabs.openTabInNewWindow(tabOf('/detail'));

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/detail'),
      '_blank',
      'noopener=yes,noreferrer=yes',
    );

    open.mockRestore();
  });
});

describe('useTabs 禁用状态计算', /** 右键菜单的各项禁用标记必须与真实 store 状态一致。 */ () => {
  it('当前标签页在固定标签页之后', /** 左侧只剩固定标签页时必须禁用"关闭左侧"。 */ () => {
    openTabs('/home', '/list', '/detail');
    at(store.tabs, 0).meta.affixTab = true;
    const tabs = mountUseTabs();

    expect(tabs.getTabDisableState()).toEqual({
      disabledCloseAll: false,
      disabledCloseCurrent: false,
      disabledCloseLeft: true,
      disabledCloseOther: false,
      disabledCloseRight: false,
      disabledRefresh: false,
    });
  });

  it('非当前标签页只允许关闭操作', /** 非当前标签页的刷新与左右关闭语义不同，必须全部禁用。 */ () => {
    openTabs('/home', '/list', '/detail');
    at(store.tabs, 0).meta.affixTab = true;
    const tabs = mountUseTabs();

    expect(tabs.getTabDisableState(tabOf('/detail'))).toEqual({
      disabledCloseAll: false,
      disabledCloseCurrent: false,
      disabledCloseLeft: true,
      disabledCloseOther: true,
      disabledCloseRight: true,
      disabledRefresh: true,
    });
  });

  it('当前标签页是固定标签页时禁用关闭当前', /** 固定标签页不允许关闭，禁用标记必须同步。 */ () => {
    openTabs('/home', '/list');
    at(store.tabs, 0).meta.affixTab = true;
    const tabs = mountUseTabs();

    // 固定标记取自传入的标签页对象本身，因此这里传 store 里的真实标签页。
    expect(tabs.getTabDisableState(at(store.getTabs, 0))).toMatchObject({
      disabledCloseCurrent: true,
    });
  });

  it('当前标签页在最右侧时禁用关闭右侧', /** 右侧没有标签页时仍显示可点会让用户点到空操作。 */ async () => {
    openTabs('/home', '/list', '/detail');
    at(store.tabs, 0).meta.affixTab = true;
    await router.push('/detail');
    const tabs = mountUseTabs();

    expect(tabs.getTabDisableState()).toMatchObject({
      disabledCloseLeft: false,
      disabledCloseRight: true,
    });
  });

  it('只剩一个标签页时关闭类操作全部禁用', /** 唯一标签页不允许被关闭，包括"关闭其他"。 */ () => {
    openTabs('/list');
    const tabs = mountUseTabs();

    expect(tabs.getTabDisableState()).toMatchObject({
      disabledCloseAll: true,
      disabledCloseCurrent: true,
      disabledCloseOther: true,
    });
  });
});

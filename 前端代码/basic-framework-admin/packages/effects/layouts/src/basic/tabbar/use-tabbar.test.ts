/**
 * 标签栏状态机（effects/layouts 的 basic/tabbar/use-tabbar）真实行为回归。
 *
 * 该组合式函数是标签栏与真实 store、真实路由之间唯一的适配层：它负责初始化固定标签页、把当前
 * 路由登记成标签、把点击与关闭转发给 store，并按标签位置与固定标记生成右键菜单（含每项的禁用
 * 状态、图标与文案）。任何一处算错都会让用户点到失效菜单——关闭左侧关掉了固定标签页、固定按钮
 * 只做单向切换、最大化后无法还原、刷新作用在别的标签页上。用例使用真实 Pinia、真实内存路由与
 * 真实中文/英文语言包，只对浏览器新窗口能力做替身，断言的是 store 的真实状态、路由的真实跳转
 * 与菜单的真实文案。
 */
import type { Router } from 'vue-router';

import type { RouteMeta, TabDefinition } from '@vben/types';

import { mount } from '@vue/test-utils';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { i18n, loadLocaleMessages, setupI18n } from '@vben/locales';
import { preferences, resetPreferences } from '@vben/preferences';
import { initStores, useAccessStore, useTabbarStore } from '@vben/stores';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { useTabbar } from './use-tabbar';

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

/** 被测组合式函数暴露的标签栏操作与状态。 */
type TabbarApi = ReturnType<typeof useTabbar>;

/** 右键菜单项类型，直接从被测函数的返回值推导，避免额外引入包依赖。 */
type ContextMenuItem = ReturnType<TabbarApi['createContextMenus']>[number];

/** 用例可覆盖的标签页字段；meta 只写关心的键。 */
type TabOverrides = Omit<Partial<TabDefinition>, 'meta'> & {
  meta?: Partial<RouteMeta>;
};

/** 真实标签页 store；所有断言都读它而不是镜像内部变量。 */
let store: ReturnType<typeof useTabbarStore>;
/** 真实访问权限 store，用它的菜单变化驱动固定标签页初始化。 */
let accessStore: ReturnType<typeof useAccessStore>;
/** 真实路由实例；内存历史保证用例之间互不干扰。 */
let router: Router;
/** 与挂载组件共享的 Pinia 实例，确保 store 与组合式函数看到同一份状态。 */
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
 * 取出 store 中指定路径的真实标签页。
 * @param path 目标标签页路径。
 * @returns store 中该路径的标签页对象。
 * @throws 标签页不存在时抛出，避免断言作用在 undefined 上。
 */
function realTab(path: string): TabDefinition {
  const tab = store.getTabs.find(
    /** 按路径定位真实标签页。 */ (item) => item.path === path,
  );
  if (!tab) {
    throw new Error(`标签页 ${path} 不存在`);
  }
  return tab;
}

/** 读取当前真实标签页的路径顺序，固定标签页按真实 getter 排在最前。 */
function paths(): string[] {
  return store.getTabs.map(/** 断言只关心路径。 */ (tab) => tab.path);
}

/**
 * 在真实组件上下文里调用目标组合式函数。
 * @returns 组合式函数暴露的标签栏操作与状态。
 * @throws setup 未执行时报告挂载契约变化。
 */
function mountUseTabbar(): TabbarApi {
  let tabbar: TabbarApi | undefined;
  wrapper = mount(
    defineComponent({
      /**
       * 在真实 setup 中调用目标组合式函数并渲染空节点。
       * @returns 返回渲染空节点的函数。
       */
      setup() {
        tabbar = useTabbar();
        /**
         * 渲染空节点，组合式函数的行为由返回值驱动。
         * @returns 空节点。
         */
        function renderStub() {
          return h('div', { class: 'probe-tabbar' });
        }

        return renderStub;
      },
    }),
    { global: { plugins: [pinia, router, i18n] } },
  );
  if (!tabbar) {
    throw new Error('组合式函数必须在 setup 中返回标签栏操作');
  }
  return tabbar;
}

/**
 * 取出右键菜单里的指定项。
 * @param menus 待查找的菜单集合。
 * @param key 菜单项的唯一标识。
 * @returns 命中的菜单项。
 * @throws 菜单项缺失时抛出，避免断言落到 undefined 上。
 */
function needMenu(menus: ContextMenuItem[], key: string): ContextMenuItem {
  const item = menus.find(
    /** 按唯一标识定位菜单项。 */ (menu) => menu.key === key,
  );
  if (!item) {
    throw new Error(`右键菜单缺少 ${key} 项`);
  }
  return item;
}

/**
 * 触发菜单项的真实处理函数。
 * @param item 目标菜单项。
 * @returns 处理函数执行完成后兑现的 Promise。
 */
async function triggerMenu(item: ContextMenuItem): Promise<void> {
  // 菜单回调只透传宿主数据包，组件不解释其结构，这里按真实调用形态传空对象。
  await item.handler?.({});
}

beforeAll(
  /** 装配真实中文语言包：右键菜单文案与标签标题都由 $t 真实翻译。 */ async () => {
    await setupI18n(
      createApp({
        /** 语言包装配不需要渲染任何界面元素。 */
        render: () => null,
      }),
      { defaultLocale: 'zh-CN' },
    );
  },
);

beforeEach(
  /** 每例使用独立真实 Pinia 与真实路由，避免状态、导航与偏好相互影响。 */ async () => {
    // 标签页 store 的真实持久化落在 sessionStorage，先清空避免上一例的标签页被恢复。
    sessionStorage.clear();
    resetPreferences();
    pinia = await initStores(
      createApp(
        defineComponent({
          /** 只为安装 Pinia 提供应用实例，不渲染任何界面。 */
          render: () => null,
        }),
      ),
      { namespace: 'use-tabbar-test' },
    );
    store = useTabbarStore(pinia);
    accessStore = useAccessStore(pinia);
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          component: {
            /** 路由组件不参与渲染。 */
            render: () => null,
          },
          meta: { affixTab: true, title: 'preferences.tabbar.title' },
          name: 'Home',
          path: '/home',
        },
        {
          component: {
            /** 路由组件不参与渲染。 */
            render: () => null,
          },
          meta: { title: 'common.query' },
          name: 'List',
          path: '/list',
        },
        {
          component: {
            /** 路由组件不参与渲染。 */
            render: () => null,
          },
          meta: { title: 'common.refresh' },
          name: 'Detail',
          path: '/detail',
        },
        {
          component: {
            /** 路由组件不参与渲染。 */
            render: () => null,
          },
          meta: { title: 'common.noData' },
          name: 'Other',
          path: '/other',
        },
      ],
    });
    await router.push('/list');
    await router.isReady();
  },
);

afterEach(
  /** 卸载宿主、还原语言与偏好，避免残留响应式副作用影响后续用例。 */ async () => {
    wrapper?.unmount();
    wrapper = undefined;
    await loadLocaleMessages('zh-CN');
    resetPreferences();
  },
);

describe('useTabbar 初始化与标签集合', /** 固定标签页与当前路由都必须真实进入标签栏。 */ () => {
  it('初始化时登记固定标签页并追加当前路由标签', /** 固定标签页丢失会让用户刷新后找不到入口，当前路由未登记会让页面无标签可点。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    expect(paths()).toEqual(['/home', '/list']);
    expect(realTab('/home').meta.affixTab).toBe(true);
    expect(tabbar.currentActive.value).toBe('/list');
  });

  it('标签标题按当前语言真实翻译', /** 标题未翻译会让标签栏显示 i18n 键名。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    expect(
      tabbar.currentTabs.value?.map(
        /** 只取用户可见的标题。 */ (tab) => tab.meta.title,
      ),
    ).toEqual(['标签栏', '查询']);
  });

  it('访问菜单变化时重新登记固定标签页', /** 登录后拿到的菜单变化不重新登记会让固定标签页缺失。 */ async () => {
    mountUseTabbar();
    await nextTick();
    store.tabs = store.tabs.filter(
      /** 先清空标签栏，模拟刷新前没有任何标签页。 */ (tab) =>
        tab.path !== '/home',
    );

    accessStore.accessMenus = [
      {
        name: 'DUMMY-菜单',
        path: '/home',
      },
    ];
    await nextTick();

    expect(paths()).toContain('/home');
    expect(realTab('/home').meta.affixTab).toBe(true);
  });

  it('切换语言后标签标题跟随重新翻译', /** 语言切换不刷新标题会让标签栏停留在旧语言。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    await loadLocaleMessages('en-US');

    await vi.waitFor(
      /** 等待语言变更触发的重新翻译真实生效。 */ () => {
        expect(
          tabbar.currentTabs.value?.map(
            /** 只取用户可见的标题。 */ (tab) => tab.meta.title,
          ),
        ).toEqual(['Tabbar', 'Search']);
      },
      { timeout: 2000 },
    );
  });
});

describe('useTabbar 点击与关闭', /** 点击跳转与关闭跳转决定用户能否在标签之间移动。 */ () => {
  it('点击标签跳转到该标签的完整路径', /** 点击不跳转会让标签栏形同虚设。 */ async () => {
    store.addTab(tabOf('/detail'));
    const tabbar = mountUseTabbar();

    tabbar.handleClick('/detail');

    await vi.waitFor(
      /** 等待路由真实跳转到目标标签。 */ () => {
        expect(router.currentRoute.value.fullPath).toBe('/detail');
      },
      { timeout: 2000 },
    );
  });

  it('关闭当前标签后跳转到最近访问过的标签', /** 关闭后不跳转会让内容区停留在已关闭的路由上。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    store.addTab(tabOf('/detail'));

    await tabbar.handleClose('/list');

    expect(paths()).toEqual(['/home', '/detail']);
    expect(router.currentRoute.value.fullPath).toBe('/detail');
  });

  it('关闭非当前标签时保留当前路由', /** 关闭后台标签触发跳转会打断用户当前操作。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    store.addTab(tabOf('/detail'));

    await tabbar.handleClose('/detail');

    expect(paths()).toEqual(['/home', '/list']);
    expect(router.currentRoute.value.fullPath).toBe('/list');
  });

  it('关闭不存在的标签键时保持现场', /** 失效的键被当成关闭全部会误删用户的标签页。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    await tabbar.handleClose('/not-exists');

    expect(paths()).toEqual(['/home', '/list']);
    expect(router.currentRoute.value.fullPath).toBe('/list');
  });
});

describe('useTabbar 右键菜单生成', /** 菜单项、禁用标记与图标必须与标签的真实位置一致。 */ () => {
  it('当前标签在固定标签页之后时按真实语义给出菜单与禁用标记', /** 禁用标记算错会让用户点到无效操作。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    const menus = tabbar.createContextMenus(realTab('/list'));

    expect(
      menus.map(/** 菜单顺序决定用户看到的操作分组。 */ (menu) => menu.key),
    ).toEqual([
      'close',
      'affix',
      'maximize',
      'reload',
      'open-in-new-window',
      'close-left',
      'close-right',
      'close-other',
      'close-all',
    ]);
    expect(needMenu(menus, 'close').disabled).toBe(false);
    expect(needMenu(menus, 'affix').disabled).toBeUndefined();
    expect(needMenu(menus, 'affix').text).toBe('固定');
    expect(needMenu(menus, 'maximize').text).toBe('最大化');
    expect(needMenu(menus, 'reload').disabled).toBe(false);
    expect(needMenu(menus, 'open-in-new-window').separator).toBe(true);
    // 左侧只剩固定标签页、右侧没有标签页、减去固定标签页后只剩自身，三项都必须禁用。
    expect(needMenu(menus, 'close-left').disabled).toBe(true);
    expect(needMenu(menus, 'close-right').disabled).toBe(true);
    expect(needMenu(menus, 'close-other').disabled).toBe(true);
    expect(needMenu(menus, 'close-all').disabled).toBe(false);
  });

  it('固定标签页的菜单禁用关闭并显示取消固定', /** 固定标签页被允许关闭会破坏固定的入口。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    const menus = tabbar.createContextMenus(realTab('/home'));

    expect(needMenu(menus, 'close').disabled).toBe(true);
    expect(needMenu(menus, 'affix').text).toBe('取消固定');
    expect(needMenu(menus, 'reload').disabled).toBe(true);
    expect(needMenu(menus, 'close-left').disabled).toBe(true);
    expect(needMenu(menus, 'close-right').disabled).toBe(true);
  });

  it('只剩一个标签页时关闭类操作全部禁用', /** 唯一标签页被关闭会让应用失去可停留的页面。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    await store.closeAllTabs(router);

    expect(paths()).toEqual(['/home']);
    const menus = tabbar.createContextMenus(realTab('/home'));

    expect(needMenu(menus, 'close').disabled).toBe(true);
    expect(needMenu(menus, 'close-all').disabled).toBe(true);
    expect(needMenu(menus, 'close-other').disabled).toBe(true);
    expect(needMenu(menus, 'close-left').disabled).toBe(true);
    expect(needMenu(menus, 'close-right').disabled).toBe(true);
  });

  it('菜单按 store 的菜单清单过滤', /** 不按清单过滤会让被关闭的菜单项仍然可点。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    store.setMenuList(['close', 'close-all']);

    expect(
      tabbar
        .createContextMenus(realTab('/list'))
        .map(/** 只保留清单内的菜单项。 */ (menu) => menu.key),
    ).toEqual(['close', 'close-all']);
  });
});

describe('useTabbar 右键菜单动作', /** 每个菜单项都必须作用在真实 store 与真实路由上。 */ () => {
  it('关闭当前标签页菜单项真实移除当前标签', /** 关闭项作用错标签会关掉用户正在看的页面之外的内容。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    await triggerMenu(
      needMenu(tabbar.createContextMenus(realTab('/list')), 'close'),
    );

    expect(paths()).toEqual(['/home']);
  });

  it('固定与取消固定菜单项真实切换固定标记与顺序', /** 固定只做单向切换会让用户无法取消固定。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    store.addTab(tabOf('/detail'));
    await nextTick();

    await triggerMenu(
      needMenu(tabbar.createContextMenus(realTab('/detail')), 'affix'),
    );

    expect(
      store.affixTabs.map(/** 固定集合只关心路径。 */ (tab) => tab.path),
    ).toEqual(['/home', '/detail']);
    expect(paths()).toEqual(['/home', '/detail', '/list']);

    const pinnedTab = realTab('/detail');
    expect(pinnedTab.meta.affixTab).toBe(true);
    const pinnedMenu = needMenu(tabbar.createContextMenus(pinnedTab), 'affix');
    expect(pinnedMenu.text).toBe('取消固定');
    await triggerMenu(pinnedMenu);

    expect(
      store.affixTabs.map(/** 固定集合只关心路径。 */ (tab) => tab.path),
    ).toEqual(['/home']);
    expect(realTab('/detail').meta.affixTab).toBe(false);
  });

  it('最大化菜单项先跳转目标标签再隐藏页头与侧栏', /** 不跳转会让最大化作用在别的页面上，不隐藏侧栏会让最大化名不副实。 */ async () => {
    store.addTab(tabOf('/detail'));
    const tabbar = mountUseTabbar();
    await nextTick();

    const maximize = needMenu(
      tabbar.createContextMenus(realTab('/detail')),
      'maximize',
    );
    await triggerMenu(maximize);

    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(preferences.header.hidden).toBe(true);
    expect(preferences.sidebar.hidden).toBe(true);
  });

  it('已最大化时还原菜单项只还原布局不再跳转', /** 还原时再次跳转会打断用户，不还原会让布局卡在最大化。 */ async () => {
    store.addTab(tabOf('/detail'));
    const tabbar = mountUseTabbar();
    await nextTick();
    await triggerMenu(
      needMenu(tabbar.createContextMenus(realTab('/detail')), 'maximize'),
    );
    await router.push('/list');

    // 默认菜单清单不含还原项，这里按真实 store 配置补齐后取用。
    store.setMenuList([...store.getMenuList, 'restore-maximize']);
    const restore = needMenu(
      tabbar.createContextMenus(realTab('/detail')),
      'restore-maximize',
    );
    expect(restore.text).toBe('还原');
    await triggerMenu(restore);

    expect(router.currentRoute.value.fullPath).toBe('/list');
    expect(preferences.header.hidden).toBe(false);
    expect(preferences.sidebar.hidden).toBe(false);
  });

  it('刷新菜单项按真实协议刷新当前标签', /** 刷新错标签会让用户以为页面没有重新加载。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();

    const pending = needMenu(
      tabbar.createContextMenus(realTab('/list')),
      'reload',
    ).handler?.({});

    // 刷新期间当前路由被排除缓存，这是该动作唯一可外部观察的窗口。
    expect(store.getExcludeCachedTabs).toContain('List');
    await pending;

    expect(store.getExcludeCachedTabs).not.toContain('List');
    expect(store.renderRouteView).toBe(true);
  });

  it('在新窗口打开菜单项按真实地址协议打开', /** 地址或窗口特性写错会让新窗口被浏览器拦截或打开错误页面。 */ async () => {
    store.addTab(tabOf('/detail'));
    const tabbar = mountUseTabbar();
    const open = vi
      .spyOn(window, 'open')
      .mockImplementation(
        /** 伪 DOM 不提供真实窗口，只记录打开参数。 */ () => null,
      );

    await triggerMenu(
      needMenu(
        tabbar.createContextMenus(realTab('/detail')),
        'open-in-new-window',
      ),
    );

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/detail'),
      '_blank',
      'noopener=yes,noreferrer=yes',
    );

    open.mockRestore();
  });

  it('关闭左侧菜单项保护固定标签页', /** 连固定标签页一起关闭会破坏用户固定的入口。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    store.addTab(tabOf('/detail'));
    store.addTab(tabOf('/other'));
    await router.push('/detail');
    await nextTick();

    const item = needMenu(
      tabbar.createContextMenus(realTab('/detail')),
      'close-left',
    );
    expect(item.disabled).toBe(false);
    await triggerMenu(item);

    expect(paths()).toEqual(['/home', '/detail', '/other']);
  });

  it('关闭右侧菜单项只关闭目标标签之后的标签', /** 范围算错会把目标标签及其左侧一并关闭。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    store.addTab(tabOf('/detail'));
    store.addTab(tabOf('/other'));
    await nextTick();

    const item = needMenu(
      tabbar.createContextMenus(realTab('/list')),
      'close-right',
    );
    expect(item.disabled).toBe(false);
    await triggerMenu(item);

    expect(paths()).toEqual(['/home', '/list']);
  });

  it('关闭其它菜单项保留当前标签与固定标签', /** 关闭其它时误删当前页会让用户丢失正在浏览的内容。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    store.addTab(tabOf('/detail'));
    store.addTab(tabOf('/other'));
    await nextTick();

    await triggerMenu(
      needMenu(tabbar.createContextMenus(realTab('/list')), 'close-other'),
    );

    expect(paths()).toEqual(['/home', '/list']);
  });

  it('关闭全部菜单项只保留固定标签并跳转过去', /** 全部关闭后没有可跳转的标签会让内容区空白。 */ async () => {
    const tabbar = mountUseTabbar();
    await nextTick();
    store.addTab(tabOf('/detail'));
    await nextTick();

    await triggerMenu(
      needMenu(tabbar.createContextMenus(realTab('/list')), 'close-all'),
    );

    expect(paths()).toEqual(['/home']);
    expect(router.currentRoute.value.fullPath).toBe('/home');
  });
});

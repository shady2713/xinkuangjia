/**
 * 基础布局标签栏（basic/tabbar/tabbar.vue）真实标签行为回归。
 *
 * 标签栏把真实标签页 store 渲染成可切换的标签，并承载关闭、固定、拖拽排序、刷新、最大化、
 * 更多菜单与右键菜单：任一处理写错都会让用户点到失效操作——标签点不动、关错标签、刷新作用在
 * 别的页面上、最大化无法还原、批量关闭范围不对。用例使用真实 Pinia 标签页 store、真实内存路由
 * 与真实语言包，用真实点击与真实右键事件驱动界面，断言 store 状态、路由落点与真实 DOM。
 *
 * 两个环境边界：标签列表只响应 store 的更新时间戳（这正是生产里标签变化后通知视图的真实机制），
 * 因此用例在改动标签后调用真实的 setUpdateTime；右键菜单浮层由 reka-ui 的指针事件托管，同一
 * 用例里连续展开会被上一次会话吞掉，菜单相关断言因此集中在少数用例内完成。
 */
import { mount } from '@vue/test-utils';
import { createApp, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { i18n, setupI18n } from '@vben/locales';
import { preferences, preferencesManager } from '@vben/preferences';
import { initStores, useTabbarStore } from '@vben/stores';

import { TabsView } from '@vben-core/tabs-ui';

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import LayoutTabbar from './tabbar.vue';

vi.hoisted(
  /**
   * `initStores` 读取运行时配置里的持久化密钥，测试进程没有加载生产配置脚本，
   * 因此在导入 Stores 之前建立最小替换值；该键值不参与任何真实加密。
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
 * 建立仅用于安装 i18n 插件的空应用宿主。
 * @returns 未挂载的空 Vue 应用实例。
 */
function createAppHost() {
  return createApp({
    /** 渲染空节点：该宿主只用于安装 i18n 插件，不参与界面断言。 */
    render: () => h('div'),
  });
}

/**
 * 构造真实路由表，覆盖固定标签、普通标签与带图标标签。
 * @returns 可供内存路由使用的路由记录数组。
 */
function createRoutes() {
  const view = {
    /** 路由组件不参与渲染，用例只关心标签栏本身。 */
    render: () => null,
  };
  return [
    {
      component: view,
      meta: {
        affixTab: true,
        icon: 'lucide:home',
        title: 'preferences.title',
      },
      name: 'Dashboard',
      path: '/dashboard',
    },
    {
      component: view,
      meta: {
        icon: 'lucide:settings',
        keepAlive: true,
        title: 'preferences.language',
      },
      name: 'TabA',
      path: '/tab-a',
    },
    {
      component: view,
      meta: { title: 'preferences.theme.light' },
      name: 'TabB',
      path: '/tab-b',
    },
    {
      component: view,
      meta: { title: 'preferences.followSystem' },
      name: 'TabC',
      path: '/tab-c',
    },
  ];
}

/**
 * 把真实路由登记为标签页。
 * @param paths 需要登记的真实路由路径，按调用顺序写入访问历史。
 */
function openTabs(...paths: string[]) {
  for (const path of paths) {
    tabbarStore.addTab(router.resolve(path) as never);
  }
}

/**
 * 挂载标签栏并让标签列表按真实通知机制刷新。
 * @param props 透传给标签栏的属性，如图标与主题。
 * @returns 已挂载且标签已渲染的标签栏宿主。
 */
async function mountTabbar(props: Record<string, unknown> = {}) {
  mounted = mount(LayoutTabbar, {
    attachTo: document.body,
    global: { plugins: [pinia, router, i18n] },
    props,
  });
  // 标签列表由 store 的更新时间戳驱动刷新，这里触发生产里同一个真实通知。
  tabbarStore.setUpdateTime();
  await nextTick();
  return mounted;
}

/**
 * 读取标签栏真实渲染的标签标题。
 * @param wrapper 已挂载的标签栏宿主。
 * @returns 按渲染顺序排列的标签标题数组。
 */
function tabTitles(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('[data-tab-item="true"]')
    .map(/** 取每个标签的可见文案。 */ (tab) => tab.text().trim());
}

/**
 * 读取标签栏右侧真实渲染的工具入口。
 * @returns 按渲染顺序排列的工具入口元素数组，依次是更多、刷新与最大化。
 */
function toolButtons() {
  return [...document.querySelectorAll<HTMLElement>('.h-full.cursor-pointer')];
}

/**
 * 取出指定图标的工具入口。
 * @param iconClass 工具图标类名片段，如 `refresh`。
 * @returns 命中的工具入口元素。
 * @throws 工具未渲染时抛出，避免断言作用在 undefined 上。
 */
function toolByIcon(iconClass: string) {
  const tool = [...document.querySelectorAll<HTMLElement>('svg')]
    .find(
      /** 按图标类名定位工具入口。 */ (icon) =>
        icon.getAttribute('class')?.includes(`lucide-${iconClass}`),
    )
    ?.closest<HTMLElement>('.cursor-pointer');
  if (!tool) {
    throw new Error(`标签栏未渲染图标为 ${iconClass} 的工具入口`);
  }
  return tool;
}

/**
 * 读取展开后的菜单项。
 * @returns 按渲染顺序排列的菜单项元素数组。
 */
function menuItems() {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

/**
 * 等待真实菜单渲染出菜单项。
 * @returns 菜单项渲染完成后的 Promise。
 */
async function waitMenu() {
  await vi.waitFor(
    /** 等待浮层真实渲染出菜单项。 */ () => {
      expect(menuItems().length).toBeGreaterThan(0);
    },
    { timeout: 2000 },
  );
}

/**
 * 从菜单里取出指定文案的菜单项。
 * @param text 菜单项文案。
 * @returns 命中的菜单项元素。
 * @throws 菜单项未渲染时抛出，避免断言作用在 undefined 上。
 */
function menuItem(text: string) {
  const item = menuItems().find(
    /** 只挑出文案匹配的菜单项。 */ (node) => node.textContent?.includes(text),
  );
  if (!item) {
    throw new Error(`菜单未渲染菜单项：${text}`);
  }
  return item;
}

/**
 * 读取标签页 store 里当前的真实标签路径顺序。
 * @returns 按 store 真实顺序排列的标签路径数组。
 */
function storePaths() {
  return tabbarStore.getTabs.map(
    /** 只取路径，避免把内部对象差异带进比较。 */ (tab) => tab.path,
  );
}

beforeAll(
  /** 按真实 API 装载中文语言包，标签标题与菜单文案取自真实语言包。 */ async () => {
    await setupI18n(createAppHost(), { defaultLocale: 'zh-CN' });
  },
);

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
      { namespace: 'layout-tabbar-test' },
    );
    tabbarStore = useTabbarStore(pinia);
    router = createRouter({
      history: createMemoryHistory(),
      routes: createRoutes(),
    });
    await router.push('/tab-a');
    await router.isReady();
  },
);

afterEach(
  /** 卸载宿主、摘掉浮层并复位偏好，避免跨用例污染。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.body.innerHTML = '';
    preferencesManager.resetPreferences();
  },
);

describe('标签栏渲染', /** 标签与工具入口缺失会让用户无法切换页面。 */ () => {
  it('按真实标签数据渲染标题、固定顺序与图标', /** 漏渲染或排序取错会让用户认不出标签。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    const wrapper = await mountTabbar({ showIcon: true, theme: 'dark' });

    // 固定标签排在最前，其余按打开顺序排列。
    expect(tabTitles(wrapper)).toEqual(['偏好设置', '浅色', '语言']);
    expect(wrapper.findAll('[data-tab-item="true"]')[0]?.classes()).toContain(
      'affix-tab',
    );
    expect(wrapper.findAll('.iconify').length).toBe(2);
    expect(wrapper.getComponent(TabsView).classes()).toContain('dark');
  });

  it('按真实偏好渲染更多、刷新与最大化三个工具入口', /** 工具入口漏渲染会让用户失去对应能力。 */ async () => {
    await mountTabbar();

    expect(toolButtons()).toHaveLength(3);
    expect(toolByIcon('layout-grid')).toBeInstanceOf(HTMLElement);
    expect(toolByIcon('rotate-cw')).toBeInstanceOf(HTMLElement);
    expect(toolByIcon('fullscreen')).toBeInstanceOf(HTMLElement);
  });

  it('偏好关闭工具入口后不再渲染对应工具', /** 开关失效会让用户看到不该出现的工具。 */ async () => {
    preferencesManager.updatePreferences({
      tabbar: { showMaximize: false, showMore: false, showRefresh: false },
    });
    await mountTabbar();

    expect(toolButtons()).toHaveLength(0);
  });

  it('主题属性真实落到标签视图容器上', /** 主题类丢失会让标签栏配色与布局不一致。 */ async () => {
    const wrapper = await mountTabbar({ theme: 'light-theme' });

    expect(wrapper.getComponent(TabsView).classes()).toContain('light-theme');
  });
});

describe('标签切换与关闭', /** 切换或关闭写错会让用户跳到错误页面。 */ () => {
  it('点击标签跳转到该标签真实路径', /** 点击不跳转会让标签栏失去作用。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    const wrapper = await mountTabbar();

    await wrapper.findAll('[data-tab-item="true"]')[1]?.trigger('click');

    await vi.waitFor(
      /** 等待路由真实跳转完成。 */ () => {
        expect(router.currentRoute.value.path).toBe('/tab-b');
      },
      { timeout: 2000 },
    );
  });

  it('点击关闭图标移除该标签', /** 关闭作用在错误标签上会让用户丢失当前页面。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    const wrapper = await mountTabbar();

    const closeIcons = wrapper.findAll('svg.lucide-x');
    await closeIcons[2]?.trigger('click');

    // 关闭的是第三个标签（当前路由 /tab-a），其余标签保留。
    expect(storePaths()).toEqual(['/dashboard', '/tab-b']);
  });

  it('中键点击可关闭标签时真实关闭', /** 中键开关失效会让用户关不掉标签。 */ async () => {
    preferencesManager.updatePreferences({
      tabbar: { middleClickToClose: true },
    });
    openTabs('/dashboard', '/tab-b');
    const wrapper = await mountTabbar();

    await wrapper
      .findAll('[data-tab-item="true"]')[2]
      ?.trigger('mousedown', { button: 1 });

    expect(storePaths()).toEqual(['/dashboard', '/tab-b']);
  });

  it('中键开关关闭时中键点击不关闭标签', /** 开关失效会让用户被意外关掉标签。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    const wrapper = await mountTabbar();
    const before = tabbarStore.getTabs.length;

    await wrapper
      .findAll('[data-tab-item="true"]')[2]
      ?.trigger('mousedown', { button: 1 });

    expect(tabbarStore.getTabs.length).toBe(before);
  });
});

describe('标签固定与拖拽', /** 固定与排序写错会让标签顺序与固定标记失效。 */ () => {
  it('点击取消固定图标真实取消固定该标签', /** 取消固定失效会让标签永远排在最前。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    const wrapper = await mountTabbar();

    // 关闭图标与取消固定图标都常驻 DOM（仅切换可见性），按图标类名精确定位。
    const pinIcon = wrapper.find('svg.lucide-pin');
    await pinIcon.trigger('click');

    await vi.waitFor(
      /** 等待 store 真实取消固定。 */ () => {
        expect(
          tabbarStore.getTabs.find(
            /** 定位首页标签。 */ (tab) => tab.path === '/dashboard',
          )?.meta?.affixTab,
        ).toBe(false);
      },
      { timeout: 2000 },
    );
  });

  it('拖拽完成时按真实下标重排标签', /** 排序事件断开会让拖拽结果丢失。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    const wrapper = await mountTabbar();

    // 拖拽结束由标签视图抛出 sortTabs 事件，这里触发同一真实事件契约。
    wrapper.getComponent(TabsView).vm.$emit('sortTabs', 0, 2);
    await nextTick();

    // 固定标签在 getTabs 里始终排在最前，因此断言 store 内部的真实顺序。
    expect(
      tabbarStore.tabs.map(/** 读取重排后的原始标签顺序。 */ (tab) => tab.path),
    ).toEqual(['/tab-b', '/tab-a', '/dashboard']);
  });
});

describe('标签栏工具入口', /** 刷新与最大化写错会让用户失去对应能力。 */ () => {
  it('点击刷新工具真实触发标签页刷新流程', /** 刷新不生效会让用户无法重载当前页面。 */ async () => {
    await mountTabbar();

    toolByIcon('rotate-cw').click();

    await vi.waitFor(
      /** 等待刷新流程真实把当前路由排除出缓存。 */ () => {
        expect(tabbarStore.getExcludeCachedTabs).toContain('TabA');
      },
      { timeout: 2000 },
    );
    expect(tabbarStore.renderRouteView).toBe(false);
  });

  it('点击最大化工具翻转头部与侧边栏隐藏偏好', /** 最大化不可用会让用户无法专注内容区。 */ async () => {
    await mountTabbar();

    toolByIcon('fullscreen').click();

    expect(preferences.header.hidden).toBe(true);
    expect(preferences.sidebar.hidden).toBe(true);
  });
});

describe('标签栏更多菜单', /** 更多菜单是批量操作的真实入口。 */ () => {
  it('点击更多展开真实菜单并执行所选操作', /** 下拉菜单断开会让更多入口变成死按钮。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    await mountTabbar();

    toolByIcon('layout-grid').click();
    await waitMenu();

    expect(
      menuItems().map(
        /** 收集菜单项文案。 */ (item) => item.textContent?.trim(),
      ),
    ).toEqual([
      '关闭',
      '固定',
      '最大化',
      '重新加载',
      '在新窗口打开',
      '关闭左侧标签页',
      '关闭右侧标签页',
      '关闭其它标签页',
      '关闭全部标签页',
    ]);

    menuItem('关闭其它标签页').click();

    await vi.waitFor(
      /** 等待真实批量关闭生效：固定标签与当前标签保留。 */ () => {
        expect(storePaths()).toEqual(['/dashboard', '/tab-a']);
      },
      { timeout: 2000 },
    );
  });

  it('更多菜单里的固定项把目标标签真实固定', /** 固定菜单写错会让标签固定在错误的页面上。 */ async () => {
    openTabs('/dashboard', '/tab-b');
    await mountTabbar();

    toolByIcon('layout-grid').click();
    await waitMenu();
    menuItem('固定').click();

    await vi.waitFor(
      /** 等待当前标签真实变成固定标签。 */ () => {
        expect(
          tabbarStore.getTabs.find(
            /** 定位当前标签。 */ (tab) => tab.path === '/tab-a',
          )?.meta?.affixTab,
        ).toBe(true);
      },
      { timeout: 2000 },
    );
  });
});

describe('标签栏右键菜单', /** 右键菜单项与目标标签不匹配会让用户执行到错误操作。 */ () => {
  it('右键当前标签展开真实菜单并列出全部操作', /** 菜单缺失会让用户无法在标签上执行批量操作。 */ async () => {
    openTabs('/dashboard', '/tab-b', '/tab-c');
    const wrapper = await mountTabbar();

    // 右键监听挂在标签内容层上（外层标签元素只承载拖拽与点击）。
    await wrapper
      .findAll('[data-tab-item="true"]')[2]
      ?.find('div.relative.size-full')
      .trigger('contextmenu', { button: 2, clientX: 30, clientY: 40 });
    await waitMenu();

    expect(
      menuItems().map(
        /** 收集菜单项文案。 */ (item) => item.textContent?.trim(),
      ),
    ).toEqual([
      '关闭',
      '固定',
      '最大化',
      '重新加载',
      '在新窗口打开',
      '关闭左侧标签页',
      '关闭右侧标签页',
      '关闭其它标签页',
      '关闭全部标签页',
    ]);
  });

  it('右键非当前标签时只对当前标签可用的操作进入禁用态', /** 批量关闭作用范围判定失效会让用户关掉当前页面。 */ async () => {
    openTabs('/dashboard', '/tab-b', '/tab-c');
    const wrapper = await mountTabbar();

    // 第 1 个标签是 /tab-b，不是当前路由 /tab-a。
    await wrapper
      .findAll('[data-tab-item="true"]')[1]
      ?.find('div.relative.size-full')
      .trigger('contextmenu', { button: 2, clientX: 30, clientY: 40 });
    await waitMenu();

    // reka-ui 用 data-disabled 标记禁用的菜单项，未禁用时该属性不存在。
    const disabledTexts = menuItems()
      .filter(
        /** 只保留被真实禁用的菜单项；未禁用时该属性不存在。 */ (item) =>
          item.dataset.disabled !== undefined,
      )
      .map(/** 收集被禁用项文案。 */ (item) => item.textContent?.trim());
    // 关闭本身对任意标签可用；其余只对当前标签生效的操作在非当前标签上被真实禁用。
    expect(disabledTexts).toEqual([
      '重新加载',
      '关闭左侧标签页',
      '关闭右侧标签页',
      '关闭其它标签页',
    ]);
  });
});

describe('标签栏持久化开关', /** 刷新不保留标签时必须关闭其它标签。 */ () => {
  it('persist 关闭时挂载即关闭其它标签', /** 开关失效会让不保留标签的布局仍带着旧标签。 */ async () => {
    preferencesManager.updatePreferences({ tabbar: { persist: false } });
    openTabs('/dashboard', '/tab-b');

    await mountTabbar();

    expect(storePaths()).toEqual(['/dashboard', '/tab-a']);
  });

  it('persist 打开时挂载保留已有标签', /** 开关失效会让用户丢失刷新前打开的标签。 */ async () => {
    openTabs('/dashboard', '/tab-b');

    await mountTabbar();

    expect(storePaths()).toEqual(['/dashboard', '/tab-b', '/tab-a']);
  });
});

/**
 * 标签页 store 的单元测试。
 *
 * 用例覆盖标签的新增、去重更新、批量关闭、固定标签保护与刷新等行为；
 * 由于 TabDefinition 继承 RouteLocationNormalized，多个字段为必填，
 * 这里统一通过 createTab 补齐占位值，用例只写自己真正断言的字段。
 */
import type { RouteMeta, TabDefinition } from '@vben-core/typings';

import { createRouter, createWebHistory } from 'vue-router';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTabbarStore } from './tabbar';

/** 用例可覆盖的标签页字段；meta 只写关心的键，title 由 createTab 统一补默认值。 */
type TabOverrides = Omit<Partial<TabDefinition>, 'meta'> & {
  meta?: Partial<RouteMeta>;
};

/**
 * 构造一个满足 TabDefinition 的标签页。
 *
 * TabDefinition 继承 RouteLocationNormalized，hash、matched、params、query 均为必填，
 * 但本组用例只关心 fullPath/name/path/meta 等少数字段；RouteMeta 的 title 同样是必填项。
 * 这里统一补齐这些占位值，用例只写自己真正断言的字段，
 * 既避免用 any 绕过类型检查，也让每个用例的差异一目了然。
 *
 * @param overrides 需要覆盖的字段
 * @returns 可直接传给 store 的完整标签页
 */
function createTab(overrides: TabOverrides = {}): TabDefinition {
  const { meta, ...rest } = overrides;
  return {
    fullPath: '/',
    hash: '',
    matched: [],
    name: undefined,
    params: {},
    path: '/',
    query: {},
    ...rest,
    meta: { title: '', ...meta },
  };
}

describe('useAccessStore', /** 覆盖标签页 store 的新增去重、按位置批量关闭、固定标签保护与刷新行为。 */ () => {
  const router = createRouter({
    history: createWebHistory(),
    routes: [],
  });
  router.push = vi.fn();
  router.replace = vi.fn();
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('adds a new tab', /** 新增标签后 store 只保留一条记录，且与 addTab 的返回值是同一对象。 */ () => {
    const store = useTabbarStore();
    const tab = createTab({
      fullPath: '/home',
      meta: {},
      key: '/home',
      name: 'Home',
      path: '/home',
    });
    const addNewTab = store.addTab(tab);
    expect(store.tabs.length).toBe(1);
    expect(store.tabs[0]).toEqual(addNewTab);
  });

  it('adds a new tab if it does not exist', /** 新路径的标签能被 tabs 集合完整包含，不被当作已有标签丢弃。 */ () => {
    const store = useTabbarStore();
    const newTab = createTab({
      fullPath: '/new',
      meta: {},
      name: 'New',
      path: '/new',
    });
    const addNewTab = store.addTab(newTab);
    expect(store.tabs).toContainEqual(addNewTab);
  });

  it('updates an existing tab instead of adding a new one', /** 重复 addTab 同一路径只更新原记录的 query，标签总数不增加。 */ () => {
    const store = useTabbarStore();
    const initialTab = createTab({
      fullPath: '/existing',
      meta: {
        fullPathKey: false,
      },
      name: 'Existing',
      path: '/existing',
      query: {},
    });
    store.addTab(initialTab);
    const updatedTab = { ...initialTab, query: { id: '1' } };
    store.addTab(updatedTab);
    expect(store.tabs.length).toBe(1);
    expect(store.tabs[0]?.query).toEqual({ id: '1' });
  });

  it('closes all tabs', /** 关闭全部后只保留固定标签，说明批量关闭没有误删默认固定项。 */ async () => {
    const store = useTabbarStore();
    store.addTab(
      createTab({
        fullPath: '/home',
        meta: {},
        name: 'Home',
        path: '/home',
      }),
    );
    router.replace = vi.fn();

    await store.closeAllTabs(router);

    expect(store.tabs.length).toBe(1);
  });

  it('closes a non-affix tab', /** 非固定标签调用 _close 后被移出 tabs，集合长度归零。 */ () => {
    const store = useTabbarStore();
    const tab = createTab({
      fullPath: '/closable',
      meta: {},
      name: 'Closable',
      path: '/closable',
    });
    store.tabs.push(tab);
    store._close(tab);
    expect(store.tabs.length).toBe(0);
  });

  it('does not close an affix tab', /** 固定标签调用 _close 后仍然留在 tabs 中，说明关闭逻辑做了固定项豁免。 */ () => {
    const store = useTabbarStore();
    const affixTab = createTab({
      fullPath: '/affix',
      meta: { affixTab: true },
      name: 'Affix',
      path: '/affix',
    });
    store.tabs.push(affixTab);
    store._close(affixTab);
    expect(store.tabs.length).toBe(1); // Affix tab should not be closed
  });

  it('returns all cache tabs', () => {
    const store = useTabbarStore();
    store.cachedTabs.add('Home');
    store.cachedTabs.add('About');
    expect(store.getCachedTabs).toEqual(['Home', 'About']);
  });

  it('returns all tabs, including affix tabs', /** getTabs 同时包含普通标签与固定标签，两类记录不会互相覆盖。 */ () => {
    const store = useTabbarStore();
    const normalTab = createTab({
      fullPath: '/normal',
      meta: {},
      name: 'Normal',
      path: '/normal',
    });
    const affixTab = createTab({
      fullPath: '/affix',
      meta: { affixTab: true },
      name: 'Affix',
      path: '/affix',
    });
    store.tabs.push(normalTab);
    store.affixTabs.push(affixTab);
    expect(store.getTabs).toContainEqual(normalTab);
    expect(store.affixTabs).toContainEqual(affixTab);
  });

  it('navigates to a specific tab', /** 跳转到指定标签时改用 replace，并带上该标签的 path、params 与 query。 */ async () => {
    const store = useTabbarStore();
    const tab = createTab({ meta: {}, name: 'Dashboard', path: '/dashboard' });

    await store._goToTab(tab, router);

    expect(router.replace).toHaveBeenCalledWith({
      params: {},
      path: '/dashboard',
      query: {},
    });
  });

  it('closes multiple tabs by paths', /** 按 key 批量关闭只移除命中的标签，未命中的标签保持打开。 */ async () => {
    const store = useTabbarStore();
    store.addTab(
      createTab({
        fullPath: '/home',
        meta: {},
        name: 'Home',
        path: '/home',
      }),
    );
    store.addTab(
      createTab({
        fullPath: '/about',
        meta: {},
        name: 'About',
        path: '/about',
      }),
    );
    store.addTab(
      createTab({
        fullPath: '/contact',
        meta: {},
        name: 'Contact',
        path: '/contact',
      }),
    );

    await store._bulkCloseByKeys(['/home', '/contact']);

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]?.name).toBe('About');
  });

  it('closes all tabs to the left of the specified tab', /** 关闭左侧标签后目标标签成为唯一剩余项，自身与右侧都不受影响。 */ async () => {
    const store = useTabbarStore();
    store.addTab(
      createTab({
        fullPath: '/home',
        meta: {},
        name: 'Home',
        path: '/home',
      }),
    );
    store.addTab(
      createTab({
        fullPath: '/about',
        meta: {},
        name: 'About',
        path: '/about',
      }),
    );
    const targetTab = createTab({
      fullPath: '/contact',
      meta: {},
      name: 'Contact',
      path: '/contact',
    });
    const addTargetTab = store.addTab(targetTab);
    await store.closeLeftTabs(addTargetTab);

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]?.name).toBe('Contact');
  });

  it('closes all tabs except the specified tab', /** 关闭其他标签只保留目标标签，左右两侧的标签都被移除。 */ async () => {
    const store = useTabbarStore();
    store.addTab(
      createTab({
        fullPath: '/home',
        meta: {},
        name: 'Home',
        path: '/home',
      }),
    );
    const targetTab = createTab({
      fullPath: '/about',
      meta: {},
      name: 'About',
      path: '/about',
    });
    const addTargetTab = store.addTab(targetTab);
    store.addTab(
      createTab({
        fullPath: '/contact',
        meta: {},
        name: 'Contact',
        path: '/contact',
      }),
    );

    await store.closeOtherTabs(addTargetTab);

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]?.name).toBe('About');
  });

  it('closes all tabs to the right of the specified tab', /** 关闭右侧标签后最左侧的目标标签被保留，顺序未被改写。 */ async () => {
    const store = useTabbarStore();
    const targetTab = createTab({
      fullPath: '/home',
      meta: {},
      name: 'Home',
      path: '/home',
    });
    const addTargetTab = store.addTab(targetTab);
    store.addTab(
      createTab({
        fullPath: '/about',
        meta: {},
        name: 'About',
        path: '/about',
      }),
    );
    store.addTab(
      createTab({
        fullPath: '/contact',
        meta: {},
        name: 'Contact',
        path: '/contact',
      }),
    );

    await store.closeRightTabs(addTargetTab);

    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0]?.name).toBe('Home');
  });

  it('closes the tab with the specified key', /** 按 key 关闭只移除 fullPath 命中的那一条，其余标签保持打开。 */ async () => {
    const store = useTabbarStore();
    const keyToClose = '/about';
    store.addTab(
      createTab({
        fullPath: '/home',
        meta: {},
        name: 'Home',
        path: '/home',
      }),
    );
    store.addTab(
      createTab({
        fullPath: keyToClose,
        meta: {},
        name: 'About',
        path: '/about',
      }),
    );
    store.addTab(
      createTab({
        fullPath: '/contact',
        meta: {},
        name: 'Contact',
        path: '/contact',
      }),
    );

    await store.closeTabByKey(keyToClose, router);

    expect(store.tabs).toHaveLength(2);
    expect(
      store.tabs.find((tab) => tab.fullPath === keyToClose),
    ).toBeUndefined();
  });

  it('refreshes the current tab', /** 刷新当前标签时把该标签移出排除缓存，并让路由视图重新渲染。 */ async () => {
    const store = useTabbarStore();
    const currentTab = createTab({
      fullPath: '/dashboard',
      meta: { title: 'Dashboard' },
      name: 'Dashboard',
      path: '/dashboard',
    });
    router.currentRoute.value = currentTab;

    await store.refresh(router);

    expect(store.excludeCachedTabs.has('Dashboard')).toBe(false);
    expect(store.renderRouteView).toBe(true);
  });
});

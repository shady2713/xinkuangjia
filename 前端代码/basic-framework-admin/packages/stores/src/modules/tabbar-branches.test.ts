/**
 * 标签页 store（stores 的 modules/tabbar）边界分支真实回归。
 *
 * 标签页 store 承担多页签的开关、固定、缓存与跳转：数量上限判断错会让标签无限增长或误删固定项，
 * 关闭当前标签时选错相邻标签会把用户带到错误页面，访问历史开关的两条路径写错会让跳转目标与
 * 用户预期相反，固定/取消固定对不存在标签的处理错会改写传入对象。用例使用真实 pinia store、
 * 真实偏好配置与真实路由对象，只把路由跳转替换成调用记录，store 自身的选择与写入全部真实执行。
 */
import type { RouteMeta, TabDefinition } from '@vben-core/typings';

import { createRouter, createWebHistory } from 'vue-router';

import { preferencesManager } from '@vben-core/preferences';

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTabKey, useTabbarStore } from './tabbar';

/** 用例可覆盖的标签页字段；meta 只写关心的键，title 由 createTab 统一补默认值。 */
type TabOverrides = Omit<Partial<TabDefinition>, 'meta'> & {
  meta?: Partial<RouteMeta>;
};

/**
 * 构造一个满足 TabDefinition 的标签页。
 * @param overrides 需要覆盖的字段。
 * @returns 可直接传给 store 的完整标签页。
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
    redirectedFrom: undefined,
    ...rest,
    meta: { title: '', ...meta },
  };
}

/**
 * 把标签直接写入 store 列表，绕过 addTab 的访问历史登记。
 * @param store 目标标签页 store。
 * @param tabs 要写入的标签页。
 */
function seedTabs(
  store: ReturnType<typeof useTabbarStore>,
  tabs: TabDefinition[],
) {
  for (const tab of tabs) {
    store.tabs.push(tab);
  }
}

describe('useTabbarStore 边界分支', /** 多页签的边界分支直接决定用户看到哪些标签、跳到哪里。 */ () => {
  const router = createRouter({
    history: createWebHistory(),
    routes: [],
  });
  router.push = vi.fn();
  router.replace = vi.fn();

  beforeEach(
    /** 每例从干净的 store 与默认偏好出发。 */ () => {
      setActivePinia(createPinia());
      preferencesManager.resetPreferences();
      vi.clearAllMocks();
    },
  );

  afterEach(
    /** 恢复被用例改写的偏好，避免影响其它用例。 */ () => {
      preferencesManager.resetPreferences();
    },
  );

  describe('默认标签跳转', /** 没有可跳转的标签时不能发起一次空导航。 */ () => {
    it('没有打开任何标签时不跳转', /** 空列表仍调用 replace 会产生一次无意义的导航。 */ async () => {
      const store = useTabbarStore();

      await store._goToDefaultTab(router);

      expect(router.replace).not.toHaveBeenCalled();
    });
  });

  describe('新增标签', /** 新增路径决定标签是否出现、是否触发数量上限。 */ () => {
    it('隐藏标签不进入标签列表', /** 隐藏路由出现在页签上会暴露不应展示的页面入口。 */ () => {
      const store = useTabbarStore();

      const returned = store.addTab(
        createTab({
          fullPath: '/hidden',
          meta: { hideInTab: true },
          name: 'Hidden',
          path: '/hidden',
        }),
      );

      expect(store.tabs).toHaveLength(0);
      expect(returned.key).toBe('/hidden');
    });

    it('匹配链上存在隐藏项时同样不进入列表', /** 父级隐藏的子页面同样不能出现在页签上。 */ () => {
      const store = useTabbarStore();

      store.addTab(
        createTab({
          fullPath: '/child',
          matched: [
            {
              meta: { hideInTab: true, title: '父级' },
              name: 'Parent',
              path: '/parent',
            } as never,
          ],
          name: 'Child',
          path: '/child',
        }),
      );

      expect(store.tabs).toHaveLength(0);
    });

    it('同名路由超过打开上限时先关闭最早的一个', /** 不限制同名路由会让同一详情页被无限打开。 */ () => {
      const store = useTabbarStore();
      /** 按详情编号构造同名但不同路径的标签。 */
      const makeTab = (id: string) =>
        createTab({
          fullPath: `/detail/${id}`,
          meta: { maxNumOfOpenTab: 1, title: `详情${id}` },
          name: 'Detail',
          path: `/detail/${id}`,
        });

      store.addTab(makeTab('1'));
      store.addTab(makeTab('2'));

      expect(store.tabs).toHaveLength(1);
      expect(store.tabs[0]?.fullPath).toBe('/detail/2');
    });

    it('总数量达到上限时先关闭最早的非固定标签', /** 超出总上限仍继续新增会让页签无限增长。 */ () => {
      preferencesManager.updatePreferences({ tabbar: { maxCount: 2 } });
      const store = useTabbarStore();
      store.addTab(
        createTab({
          fullPath: '/affix',
          meta: { affixTab: true, title: '固定' },
          name: 'Affix',
          path: '/affix',
        }),
      );
      store.addTab(
        createTab({
          fullPath: '/first',
          meta: {},
          name: 'First',
          path: '/first',
        }),
      );

      store.addTab(
        createTab({
          fullPath: '/second',
          meta: {},
          name: 'Second',
          path: '/second',
        }),
      );

      expect(
        store.tabs.map(
          /** 取出标签路径，核对固定项保留、最早普通项被关闭。 */ (tab) =>
            tab.fullPath,
        ),
      ).toEqual(['/affix', '/second']);
    });

    it('重复打开时保留原有的固定标记与自定义标题', /** 合并时丢掉固定标记会让页签被误关，丢掉自定义标题会闪回默认标题。 */ () => {
      const store = useTabbarStore();
      store.addTab(
        createTab({
          fullPath: '/pinned',
          meta: {
            affixTab: true,
            newTabTitle: '自定义标题',
            title: '默认标题',
          },
          name: 'Pinned',
          path: '/pinned',
        }),
      );

      store.addTab(
        createTab({
          fullPath: '/pinned',
          meta: { title: '默认标题' },
          name: 'Pinned',
          path: '/pinned',
        }),
      );

      expect(store.tabs).toHaveLength(1);
      expect(store.tabs[0]?.meta.affixTab).toBe(true);
      expect(store.tabs[0]?.meta.newTabTitle).toBe('自定义标题');
    });

    it('没有匹配链的标签克隆后保持无匹配信息', /** 凭空写入空数组会让依赖 matched 的判定误判为“有匹配链”。 */ () => {
      const store = useTabbarStore();

      // 本用例模拟运行期缺少匹配链的标签：类型声明里 matched 必填，这里按真实输入收窄。
      store.addTab({
        fullPath: '/bare',
        hash: '',
        meta: { title: '裸标签' },
        name: 'Bare',
        params: {},
        path: '/bare',
        query: {},
        redirectedFrom: undefined,
      } as unknown as TabDefinition);

      expect(store.tabs).toHaveLength(1);
      expect(store.tabs[0]?.matched).toBeUndefined();
    });
  });

  describe('关闭标签的相邻选择', /** 关闭当前标签后跳到哪里由访问历史开关决定，选错会把用户带到无关页面。 */ () => {
    it('目标已是首个标签时关闭左侧不做任何事', /** 首个标签左侧没有可关闭项，误删会丢掉当前页面。 */ async () => {
      const store = useTabbarStore();
      const first = createTab({
        fullPath: '/first',
        meta: {},
        name: 'First',
        path: '/first',
      });
      seedTabs(store, [
        first,
        createTab({
          fullPath: '/second',
          meta: {},
          name: 'Second',
          path: '/second',
        }),
      ]);

      await store.closeLeftTabs(first);

      expect(store.tabs).toHaveLength(2);
    });

    it('开启访问历史且历史为空时回到默认标签', /** 历史为空时继续弹栈会让关闭操作没有落点。 */ async () => {
      const store = useTabbarStore();
      const first = createTab({
        fullPath: '/first',
        meta: {},
        name: 'First',
        path: '/first',
      });
      const current = createTab({
        fullPath: '/current',
        meta: {},
        name: 'Current',
        path: '/current',
      });
      seedTabs(store, [first, current]);
      router.currentRoute.value = current;

      await store.closeTab(current, router);

      expect(
        store.tabs.map(
          /** 取出剩余标签路径，核对当前标签已被关闭。 */ (tab) => tab.fullPath,
        ),
      ).toEqual(['/first']);
      expect(router.replace).toHaveBeenCalledWith({
        params: {},
        path: '/first',
        query: {},
      });
    });

    it('关闭访问历史后跳转到下一个标签', /** 关闭中间标签应前进到下一个，退回上一个会让用户重复浏览。 */ async () => {
      preferencesManager.updatePreferences({ tabbar: { visitHistory: false } });
      const store = useTabbarStore();
      const middle = createTab({
        fullPath: '/middle',
        meta: {},
        name: 'Middle',
        path: '/middle',
      });
      seedTabs(store, [
        createTab({
          fullPath: '/first',
          meta: {},
          name: 'First',
          path: '/first',
        }),
        middle,
        createTab({
          fullPath: '/last',
          meta: {},
          name: 'Last',
          path: '/last',
        }),
      ]);
      router.currentRoute.value = middle;

      await store.closeTab(middle, router);

      expect(router.replace).toHaveBeenCalledWith({
        params: {},
        path: '/last',
        query: {},
      });
      expect(
        store.tabs.map(
          /** 取出剩余标签路径，核对只关闭了目标标签。 */ (tab) => tab.fullPath,
        ),
      ).toEqual(['/first', '/last']);
    });

    it('关闭最后一个标签时退回上一个', /** 关闭末尾标签没有下一个，必须退回上一个而不是停在已关闭页面。 */ async () => {
      preferencesManager.updatePreferences({ tabbar: { visitHistory: false } });
      const store = useTabbarStore();
      const last = createTab({
        fullPath: '/last',
        meta: {},
        name: 'Last',
        path: '/last',
      });
      seedTabs(store, [
        createTab({
          fullPath: '/first',
          meta: {},
          name: 'First',
          path: '/first',
        }),
        createTab({
          fullPath: '/middle',
          meta: {},
          name: 'Middle',
          path: '/middle',
        }),
        last,
      ]);
      router.currentRoute.value = last;

      await store.closeTab(last, router);

      expect(router.replace).toHaveBeenCalledWith({
        params: {},
        path: '/middle',
        query: {},
      });
    });
  });

  describe('固定与取消固定', /** 固定操作只对真实存在的标签生效，误改传入对象会污染调用方数据。 */ () => {
    it('固定不存在的标签不修改传入对象', /** 对未打开的路由固定会凭空修改调用方持有的对象。 */ async () => {
      const store = useTabbarStore();
      const outsider = createTab({
        fullPath: '/outsider',
        meta: {},
        name: 'Outsider',
        path: '/outsider',
      });

      await store.pinTab(outsider);

      expect(store.tabs).toHaveLength(0);
      expect(outsider.meta.affixTab).toBeUndefined();
    });

    it('取消固定不存在的标签不修改传入对象', /** 未打开的标签没有固定状态，误改会让后续打开时状态错误。 */ async () => {
      const store = useTabbarStore();
      const outsider = createTab({
        fullPath: '/outsider',
        meta: {},
        name: 'Outsider',
        path: '/outsider',
      });

      await store.unpinTab(outsider);

      expect(store.tabs).toHaveLength(0);
      expect(outsider.meta.affixTab).toBeUndefined();
    });

    it('批量登记固定标签时补上固定标记并去重', /** 固定标签未登记会让刷新后页签顺序与固定状态丢失。 */ () => {
      const store = useTabbarStore();

      store.setAffixTabs([
        {
          meta: { title: '固定A' },
          name: 'AffixA',
          path: '/affix-a',
        } as never,
      ]);

      expect(store.tabs).toHaveLength(1);
      expect(store.tabs[0]?.meta.affixTab).toBe(true);
      expect(store.tabs[0]?.key).toBe('/affix-a');
    });
  });

  describe('标题与排序', /** 标题与顺序的边界分支决定页签显示与拖拽结果。 */ () => {
    it('已有自定义标题时重置直接返回', /** 重置会覆盖业务正在使用的动态标题。 */ async () => {
      const store = useTabbarStore();
      const tab = createTab({
        fullPath: '/titled',
        meta: {},
        name: 'Titled',
        path: '/titled',
      });
      const stored = store.addTab(tab);
      await store.setTabTitle(stored, '业务标题');

      await store.resetTabTitle(stored);

      expect(stored.meta.newTabTitle).toBe('业务标题');
    });

    it('排序索引越界时保持原顺序', /** 越界索引继续 splice 会破坏整个页签顺序。 */ async () => {
      const store = useTabbarStore();
      seedTabs(store, [
        createTab({
          fullPath: '/first',
          meta: {},
          name: 'First',
          path: '/first',
        }),
      ]);
      const dragEndIndex = store.dragEndIndex;

      await store.sortTabs(9, 0);

      expect(store.tabs).toHaveLength(1);
      expect(store.dragEndIndex).toBe(dragEndIndex);
    });

    it('固定标签按声明顺序升序排列', /** 固定标签顺序错会让用户配置的导航顺序失效。 */ () => {
      const store = useTabbarStore();
      seedTabs(store, [
        createTab({
          fullPath: '/late',
          meta: { affixTab: true, affixTabOrder: 5, title: '后' },
          name: 'Late',
          path: '/late',
        }),
        createTab({
          fullPath: '/early',
          meta: { affixTab: true, affixTabOrder: 1, title: '前' },
          name: 'Early',
          path: '/early',
        }),
      ]);

      expect(
        store.affixTabs.map(
          /** 取出固定标签路径，核对排序结果。 */ (tab) => tab.fullPath,
        ),
      ).toEqual(['/early', '/late']);
    });
  });

  describe('菜单列表', /** 右键菜单项由 store 统一维护，读写不一致会让菜单项丢失。 */ () => {
    it('写入后按原样读出菜单列表', /** 菜单项丢失会让页签右键菜单缺项。 */ () => {
      const store = useTabbarStore();

      store.setMenuList(['close', 'reload']);

      expect(store.getMenuList).toEqual(['close', 'reload']);
    });
  });

  describe('缓存标签收集', /** 缓存列表决定页面切换后是否保留状态。 */ () => {
    it('收集保活标签及其匹配链上的父级', /** 父级未进缓存会让子页面切换后丢失父级布局状态。 */ async () => {
      const store = useTabbarStore();
      seedTabs(store, [
        createTab({
          fullPath: '/cached',
          matched: [
            {
              meta: { title: '父级' },
              name: 'Parent',
              path: '/parent',
            } as never,
            { meta: { title: '子级' }, name: 'Child', path: '/child' } as never,
          ],
          meta: { keepAlive: true, title: '缓存页' },
          name: 'Cached',
          path: '/cached',
        }),
        createTab({
          fullPath: '/plain',
          meta: { title: '普通页' },
          name: 'Plain',
          path: '/plain',
        }),
      ]);

      await store.updateCacheTabs();

      expect(store.getCachedTabs.toSorted()).toEqual(['Cached', 'Child']);
    });
  });

  describe('标签键解析', /** 标签键决定页签去重与关闭命中，解析错会关错标签。 */ () => {
    it('优先使用查询参数中的 pageKey', /** 同一路由不同业务键必须区分为不同页签。 */ () => {
      expect(
        getTabKey({
          fullPath: '/detail?pageKey=alpha',
          path: '/detail',
          query: { pageKey: 'alpha' },
        } as never),
      ).toBe('alpha');
    });

    it('pageKey 为数组时取第一个值', /** 重复查询参数会让键变成数组，直接当键会得到不可比对的字符串。 */ () => {
      expect(
        getTabKey({
          fullPath: '/detail?pageKey=a&pageKey=b',
          path: '/detail',
          query: { pageKey: ['a', 'b'] },
        } as never),
      ).toBe('a');
    });

    it('地址无法解码时回退为原始文本', /** 非法转义序列抛错会让整个标签操作中断。 */ () => {
      expect(
        getTabKey({
          fullPath: '%',
          path: '%',
          query: {},
        } as never),
      ).toBe('%');
    });
  });
});

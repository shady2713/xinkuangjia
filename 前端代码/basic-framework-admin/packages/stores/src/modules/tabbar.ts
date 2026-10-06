/**
 * 标签页状态中枢：core-tabbar store 维护打开的标签、组件缓存集合与访问历史，
 * 对外提供 addTab、closeTab 及批量关闭、固定、刷新、排序等操作，
 * 以及 getTabs、getCachedTabs 等派生结果，供标签栏与路由缓存消费。
 * 只管理标签自身状态：跳转依赖调用方传入的 router，右键菜单项由菜单列表配置决定，
 * 路由权限与页面渲染不在此模块。
 */
import type { ComputedRef } from 'vue';
import type {
  RouteLocationNormalized,
  Router,
  RouteRecordNormalized,
} from 'vue-router';

import type { TabDefinition } from '@vben-core/typings';

import { toRaw } from 'vue';

import { preferences } from '@vben-core/preferences';
import {
  createStack,
  openRouteInNewWindow,
  Stack,
  startProgress,
  stopProgress,
} from '@vben-core/shared/utils';

import { acceptHMRUpdate, defineStore } from 'pinia';

/** 标签页 store 的状态：打开的标签、组件缓存集合、右键菜单项与访问历史。 */
interface TabbarState {
  /**
   * @zh_CN 当前打开的标签页列表缓存
   */
  cachedTabs: Set<string>;
  /**
   * @zh_CN 拖拽结束的索引
   */
  dragEndIndex: number;
  /**
   * @zh_CN 需要排除缓存的标签页
   */
  excludeCachedTabs: Set<string>;
  /**
   * @zh_CN 标签右键菜单列表
   */
  menuList: string[];
  /**
   * @zh_CN 是否刷新
   */
  renderRouteView?: boolean;
  /**
   * @zh_CN 当前打开的标签页列表
   */
  tabs: TabDefinition[];
  /**
   * @zh_CN 更新时间，用于一些更新场景，使用watch深度监听的话，会损耗性能
   */
  updateTime?: number;
  /**
   * @zh_CN 上一个标签页打开的标签
   */
  visitHistory: Stack<string>;
}

/**
 * @zh_CN 访问历史记录最大数量
 */
const MAX_VISIT_HISTORY = 50;

/** 标签页 store：维护打开的标签页、缓存集合、右键菜单与访问历史。 */
export const useTabbarStore = defineStore('core-tabbar', {
  actions: {
    /**
     * Close tabs in bulk
     * 按标签键批量关闭标签，并同步把命中的键从访问历史中移除。
     * 固定标签不在这里判断，由调用方先过滤好待关闭的键。
     * @param keys - 要关闭的标签键列表，未命中任何标签的键会被静默忽略。
     */
    async _bulkCloseByKeys(keys: string[]) {
      const keySet = new Set(keys);
      this.tabs = this.tabs.filter(
        (item) => !keySet.has(getTabKeyFromTab(item)),
      );
      if (isVisitHistory()) {
        this.visitHistory.remove(...keys);
      }

      await this.updateCacheTabs();
    },
    /**
     * 关闭单个标签：固定标签直接跳过，其余按标签键从当前列表中摘除，不改动访问历史。
     * @zh_CN 关闭标签页
     * @param tab - 要关闭的标签页；不在列表中时不做任何事。
     */
    _close(tab: TabDefinition) {
      if (isAffixTab(tab)) {
        return;
      }
      // 按标签键定位，找不到时得到 -1，据此跳过删除。
      const index = this.tabs.findIndex((item) => equalTab(item, tab));
      index !== -1 && this.tabs.splice(index, 1);
    },
    /**
     * 跳转到默认标签页：取当前顺序下的第一个标签，没有任何标签时不跳转。
     * @zh_CN 跳转到默认标签页
     * @param router - 执行跳转的路由实例，由调用方传入以保持本模块不直接依赖 router 单例。
     */
    async _goToDefaultTab(router: Router) {
      if (this.getTabs.length <= 0) {
        return;
      }
      const firstTab = this.getTabs[0];
      if (firstTab) {
        await this._goToTab(firstTab, router);
      }
    },
    /**
     * 跳转到指定标签：用标签自身的 path、params、query 做一次 replace，不新增历史记录。
     * @zh_CN 跳转到标签页
     * @param tab - 目标标签页，params 与 query 缺省时按空对象处理。
     * @param router - 执行跳转的路由实例。
     */
    async _goToTab(tab: TabDefinition, router: Router) {
      const { params, path, query } = tab;
      const toParams = {
        params: params || {},
        path,
        query: query || {},
      };
      await router.replace(toParams);
    },
    /**
     * 打开一个标签：先克隆入参并补上标签键，命中已有标签时合并参数而不重复添加。
     * 新增前会按路由的 maxNumOfOpenTab 与偏好里的 tabbar.maxCount 淘汰旧标签，
     * 最后刷新组件缓存并把标签键写入访问历史。
     * @zh_CN 添加标签页
     * @param routeTab - 路由定位结果；路由声明了 hideInTab 时只返回克隆对象，不进入标签列表。
     * @returns 实际写入或合并后的标签；被声明为隐藏时返回未入库的克隆对象。
     */
    addTab(routeTab: TabDefinition): TabDefinition {
      let tab = cloneTab(routeTab);
      if (!tab.key) {
        tab.key = getTabKey(routeTab);
      }
      if (!isTabShown(tab)) {
        return tab;
      }

      // 用标签键判断是否已经打开，命中的下标用于后续合并参数。
      const tabIndex = this.tabs.findIndex((item) => {
        return equalTab(item, tab);
      });

      if (tabIndex === -1) {
        const maxCount = preferences.tabbar.maxCount;
        // 获取动态路由打开数，超过 0 即代表需要控制打开数
        const maxNumOfOpenTab = (routeTab?.meta?.maxNumOfOpenTab ??
          -1) as number;
        // 如果动态路由层级大于 0 了，那么就要限制该路由的打开数限制了
        // 获取到已经打开的动态路由数, 判断是否大于某一个值
        if (
          maxNumOfOpenTab > 0 &&
          this.tabs.filter((tab) => tab.name === routeTab.name).length >=
            maxNumOfOpenTab
        ) {
          // 关闭第一个
          const index = this.tabs.findIndex(
            (item) => item.name === routeTab.name,
          );
          index !== -1 && this.tabs.splice(index, 1);
        } else if (maxCount > 0 && this.tabs.length >= maxCount) {
          // 关闭第一个
          const index = this.tabs.findIndex(
            (item) =>
              !Reflect.has(item.meta, 'affixTab') || !item.meta.affixTab,
          );
          index !== -1 && this.tabs.splice(index, 1);
        }
        this.tabs.push(tab);
      } else {
        // 页面已经存在，不重复添加选项卡，只更新选项卡参数
        const currentTab = toRaw(this.tabs)[tabIndex];
        const mergedTab = {
          ...currentTab,
          ...tab,
          meta: { ...currentTab?.meta, ...tab.meta },
        };
        if (currentTab) {
          const curMeta = currentTab.meta;
          if (Reflect.has(curMeta, 'affixTab')) {
            mergedTab.meta.affixTab = curMeta.affixTab;
          }
          if (Reflect.has(curMeta, 'newTabTitle')) {
            mergedTab.meta.newTabTitle = curMeta.newTabTitle;
          }
        }
        tab = mergedTab;
        this.tabs.splice(tabIndex, 1, mergedTab);
      }
      this.updateCacheTabs();
      // 添加访问历史记录
      if (isVisitHistory()) {
        this.visitHistory.push(tab.key as string);
      }
      return tab;
    },
    /**
     * 关闭所有标签：只保留固定标签，一个都没有时保留原列表的第一个，随后跳回默认标签。
     * 访问历史会被裁剪到剩余标签范围内。
     * @zh_CN 关闭所有标签页
     * @param router - 关闭后用于跳回默认标签的路由实例。
     */
    async closeAllTabs(router: Router) {
      // 固定标签不参与关闭，先筛出来作为保留集合。
      const newTabs = this.tabs.filter((tab) => isAffixTab(tab));
      this.tabs = newTabs.length > 0 ? newTabs : [...this.tabs].splice(0, 1);
      // 设置访问历史记录
      if (isVisitHistory()) {
        this.visitHistory.retain(
          this.tabs.map((item) => getTabKeyFromTab(item)),
        );
      }
      await this._goToDefaultTab(router);
      this.updateCacheTabs();
    },
    /**
     * 关闭指定标签左侧的全部标签，固定标签始终保留。
     * @zh_CN 关闭左侧标签页
     * @param tab - 作为分界的标签页，它本身不在关闭范围内；位于列表首位时直接返回。
     */
    async closeLeftTabs(tab: TabDefinition) {
      // 分界标签的下标即左侧标签的数量，取不到下标时说明标签已不在列表中。
      const index = this.tabs.findIndex((item) => equalTab(item, tab));

      if (index < 1) {
        return;
      }

      const leftTabs = this.tabs.slice(0, index);
      const keys: string[] = [];

      for (const item of leftTabs) {
        if (!isAffixTab(item)) {
          keys.push(item.key as string);
        }
      }
      await this._bulkCloseByKeys(keys);
    },
    /**
     * @zh_CN 关闭其他标签页
     *
     * 保留当前标签，其余非固定标签按标签键批量关闭；固定标签与未命中的键一律跳过。
     * @param tab 需要保留的标签页
     */
    async closeOtherTabs(tab: TabDefinition) {
      // 先取出全部标签键，再逐个排除要保留的那个标签。
      const closeKeys = this.tabs.map((item) => getTabKeyFromTab(item));

      const keys: string[] = [];

      for (const key of closeKeys) {
        if (key !== getTabKeyFromTab(tab)) {
          // 按标签键回查标签对象，回查不到时由 shouldCloseOtherTab 跳过该键。
          const closeTab = this.tabs.find(
            (item) => getTabKeyFromTab(item) === key,
          );
          if (shouldCloseOtherTab(closeTab)) {
            keys.push(closeTab.key as string);
          }
        }
      }
      await this._bulkCloseByKeys(keys);
    },
    /**
     * 关闭指定标签右侧的全部标签，固定标签始终保留。
     * @zh_CN 关闭右侧标签页
     * @param tab - 作为分界的标签页；位于末尾或不在列表中时不关闭任何标签。
     */
    async closeRightTabs(tab: TabDefinition) {
      // 只在分界标签确实位于列表中且右侧还有标签时才处理。
      const index = this.tabs.findIndex((item) => equalTab(item, tab));

      if (index !== -1 && index < this.tabs.length - 1) {
        const rightTabs = this.tabs.slice(index + 1);

        const keys: string[] = [];
        for (const item of rightTabs) {
          if (!isAffixTab(item)) {
            keys.push(item.key as string);
          }
        }
        await this._bulkCloseByKeys(keys);
      }
    },

    /**
     * 关闭标签：关闭的不是激活标签时直接摘除；关闭激活标签时先按访问历史回退，
     * 历史不可用则按「下一个优先、否则上一个」跳转；只剩一个标签时打印错误并放弃关闭。
     * @zh_CN 关闭标签页
     * @param tab - 要关闭的标签页。
     * @param router - 关闭激活标签后用于跳转的路由实例。
     */
    async closeTab(tab: TabDefinition, router: Router) {
      const { currentRoute } = router;
      const currentTabKey = getTabKey(currentRoute.value);
      // 关闭不是激活选项卡
      if (currentTabKey !== getTabKeyFromTab(tab)) {
        this._close(tab);
        this.updateCacheTabs();
        // 移除访问历史记录
        if (isVisitHistory()) {
          this.visitHistory.remove(getTabKeyFromTab(tab));
        }
        return;
      }
      if (this.getTabs.length <= 1) {
        console.error('Failed to close the tab; only one tab remains open.');
        return;
      }
      // 从访问历史记录中移除当前关闭的tab
      if (isVisitHistory()) {
        this.visitHistory.remove(currentTabKey);
        this._close(tab);

        let previousTab: TabDefinition | undefined;
        let previousTabKey: string | undefined;
        while (true) {
          previousTabKey = this.visitHistory.pop();
          if (!previousTabKey) {
            break;
          }
          previousTab = this.getTabByKey(previousTabKey);
          if (previousTab) {
            break;
          }
        }
        await (previousTab
          ? this._goToTab(previousTab, router)
          : this._goToDefaultTab(router));
        return;
      }
      // 未开启访问历史记录，直接跳转下一个或上一个tab
      const index = this.getTabs.findIndex(
        (item) => getTabKeyFromTab(item) === getTabKey(currentRoute.value),
      );

      const before = this.getTabs[index - 1];
      const after = this.getTabs[index + 1];

      // 下一个tab存在，跳转到下一个
      if (after) {
        this._close(tab);
        await this._goToTab(after, router);
        // 上一个tab存在，跳转到上一个
      } else if (before) {
        this._close(tab);
        await this._goToTab(before, router);
      }
    },

    /**
     * 按标签键关闭标签，键会先解码一次以兼容地址栏里的编码写法。
     * @zh_CN 通过key关闭标签页
     * @param key - 标签键；含非法百分号转义时由 decodeURIComponent 直接抛出。
     * @param router - 透传给 closeTab 的路由实例。
     */
    async closeTabByKey(key: string, router: Router) {
      const originKey = decodeURIComponent(key);
      // 解码后的键未命中任何标签时直接返回，避免误关其它标签。
      const index = this.tabs.findIndex(
        (item) => getTabKeyFromTab(item) === originKey,
      );
      if (index === -1) {
        return;
      }

      const tab = this.tabs[index];
      if (tab) {
        await this.closeTab(tab, router);
      }
    },

    /**
     * 根据tab的key获取tab
     * @param key - 标签键，与标签自身的 key 或按路由推导出的键精确匹配。
     * @returns 命中的标签；没有命中时实际为 undefined，调用方需自行判空。
     */
    getTabByKey(key: string) {
      return this.getTabs.find(
        (item) => getTabKeyFromTab(item) === key,
      ) as TabDefinition;
    },
    /**
     * 在新窗口打开标签页对应的站内地址，优先使用 fullPath，缺失时退回 path。
     * @zh_CN 新窗口打开标签页
     * @param tab - 目标标签页；只读取地址，不改变当前窗口的标签状态。
     */
    async openTabInNewWindow(tab: TabDefinition) {
      openRouteInNewWindow(tab.fullPath || tab.path);
    },

    /**
     * 把标签设为固定：标记 affixTab、沿用原标题，并把它移到固定标签分组的末尾。
     * @zh_CN 固定标签页
     * @param tab - 要固定的标签页；不在当前列表中时不做任何改动。
     */
    async pinTab(tab: TabDefinition) {
      // 按标签键定位，未命中时直接返回，避免把游离标签插入列表。
      const index = this.tabs.findIndex((item) => equalTab(item, tab));
      if (index === -1) {
        return;
      }
      const oldTab = this.tabs[index];
      tab.meta.affixTab = true;
      tab.meta.title = oldTab?.meta?.title as string;
      // this.addTab(tab);
      this.tabs.splice(index, 1, tab);
      // 过滤固定tabs，后面更改affixTabOrder的值的话可能会有问题，目前行464排序affixTabs没有设置值
      const affixTabs = this.tabs.filter((tab) => isAffixTab(tab));
      // 获得固定tabs的index
      const newIndex = affixTabs.findIndex((item) => equalTab(item, tab));
      // 交换位置重新排序
      await this.sortTabs(index, newIndex);
    },

    /**
     * 刷新标签页：传 Router 时刷新当前激活路由，传字符串时按路由名刷新指定标签。
     * 实现方式是先把路由名加入排除缓存并关掉路由视图，200ms 后再恢复，借此触发组件重建。
     * @param router - Router 实例或路由名；传当前激活路由的名字不会产生刷新效果。
     * @returns 没有业务返回值，只表示刷新流程（含按名称刷新）已经结束。
     */
    async refresh(router: Router | string) {
      // 如果是Router路由，那么就根据当前路由刷新
      // 如果是string字符串，为路由名称，则定向刷新指定标签页，不能是当前路由名称，否则不会刷新
      if (typeof router === 'string') {
        return await this.refreshByName(router);
      }

      const { currentRoute } = router;
      const { name } = currentRoute.value;

      this.excludeCachedTabs.add(name as string);
      this.renderRouteView = false;
      startProgress();

      await new Promise((resolve) => setTimeout(resolve, 200));

      this.excludeCachedTabs.delete(name as string);
      this.renderRouteView = true;
      stopProgress();
    },

    /**
     * 根据路由名称刷新指定标签页
     * 把路由名临时加入排除缓存，200ms 后移除以促使该标签重新渲染；名称不存在时只是短暂占位。
     * @param name - 路由名，即标签的 name。
     */
    async refreshByName(name: string) {
      this.excludeCachedTabs.add(name);
      await new Promise((resolve) => setTimeout(resolve, 200));
      this.excludeCachedTabs.delete(name);
    },

    /**
     * 清掉标签上的动态标题，让它回退到路由 meta 里的静态标题。
     * @zh_CN 重置标签页标题
     * @param tab - 目标标签页；已经是静态标题时直接返回。
     */
    async resetTabTitle(tab: TabDefinition) {
      if (tab?.meta?.newTabTitle) {
        return;
      }
      // 只在当前列表中就地清空；找不到说明标签已被关闭，无需处理。
      const findTab = this.tabs.find((item) => equalTab(item, tab));
      if (findTab) {
        findTab.meta.newTabTitle = undefined;
        await this.updateCacheTabs();
      }
    },

    /**
     * 设置固定标签页
     * 会把传入路由的 meta.affixTab 就地改为 true，再逐个加入标签列表。
     * @param tabs - 需要固定的路由记录；入参对象本身会被修改。
     */
    setAffixTabs(tabs: RouteRecordNormalized[]) {
      for (const tab of tabs) {
        tab.meta.affixTab = true;
        this.addTab(routeToTab(tab));
      }
    },

    /**
     * 整体替换标签右键菜单项，不做合并。
     * @zh_CN 更新菜单列表
     * @param list - 菜单项标识列表，传空数组即清空右键菜单。
     */
    setMenuList(list: string[]) {
      this.menuList = list;
    },

    /**
     * @zh_CN 设置标签页标题
     *
     * @zh_CN 支持设置静态标题字符串或计算属性作为动态标题
     * @zh_CN 当标题为计算属性时,标题会随计算属性值变化而自动更新
     * @zh_CN 适用于需要根据状态或多语言动态更新标题的场景
     *
     * @param {TabDefinition} tab - 标签页对象
     * @param {ComputedRef<string> | string} title - 标题内容,支持静态字符串或计算属性
     *
     * @example
     * // 设置静态标题
     * setTabTitle(tab, '新标签页');
     *
     * @example
     * // 设置动态标题
     * setTabTitle(tab, computed(() => t('common.dashboard')));
     */
    async setTabTitle(tab: TabDefinition, title: ComputedRef<string> | string) {
      // 标签可能已被关闭，命中后再写入，避免改到游离对象。
      const findTab = this.tabs.find((item) => equalTab(item, tab));

      if (findTab) {
        // 动态标题以 ComputedRef 存入响应式 meta；Pinia 的 state 类型会把 ref 解包成
        // string，读取方拿到的正是解包后的标题，因此这里按运行期真实存储形态写入。
        (
          findTab.meta as { newTabTitle?: ComputedRef<string> | string }
        ).newTabTitle = title;

        await this.updateCacheTabs();
      }
    },
    /** 把 updateTime 刷成当前时间戳，供依赖该字段的 watch 感知到需要重算。 */
    setUpdateTime() {
      this.updateTime = Date.now();
    },
    /**
     * 把标签从旧下标移动到新下标：先摘除再插入，并自增 dragEndIndex 通知拖拽结束。
     * @zh_CN 设置标签页顺序
     * @param oldIndex - 标签当前所在下标；越界时不做任何改动。
     * @param newIndex - 目标下标。
     */
    async sortTabs(oldIndex: number, newIndex: number) {
      const currentTab = this.tabs[oldIndex];
      if (!currentTab) {
        return;
      }
      this.tabs.splice(oldIndex, 1);
      this.tabs.splice(newIndex, 0, currentTab);
      this.dragEndIndex = this.dragEndIndex + 1;
    },

    /**
     * 按标签当前的固定状态取反：已固定则取消固定，未固定则固定。
     * @zh_CN 切换固定标签页
     * @param tab - 目标标签页，读取 meta.affixTab 决定走哪个分支。
     */
    async toggleTabPin(tab: TabDefinition) {
      const affixTab = tab?.meta?.affixTab ?? false;

      await (affixTab ? this.unpinTab(tab) : this.pinTab(tab));
    },

    /**
     * 取消标签的固定状态，并把它移到非固定标签分组的首位。
     * @zh_CN 取消固定标签页
     * @param tab - 要取消固定的标签页；不在当前列表中时不做任何改动。
     */
    async unpinTab(tab: TabDefinition) {
      // 按标签键定位，未命中时直接返回。
      const index = this.tabs.findIndex((item) => equalTab(item, tab));
      if (index === -1) {
        return;
      }
      const oldTab = this.tabs[index];
      tab.meta.affixTab = false;
      tab.meta.title = oldTab?.meta?.title as string;
      // this.addTab(tab);
      this.tabs.splice(index, 1, tab);
      // 过滤固定tabs，后面更改affixTabOrder的值的话可能会有问题，目前行464排序affixTabs没有设置值
      const affixTabs = this.tabs.filter((tab) => isAffixTab(tab));
      // 获得固定tabs的index,使用固定tabs的下一个位置也就是活动tabs的第一个位置
      const newIndex = affixTabs.length;
      // 交换位置重新排序
      await this.sortTabs(index, newIndex);
    },
    /**
     * 根据当前打开的选项卡更新缓存
     */
    async updateCacheTabs() {
      const cacheMap = new Set<string>();

      for (const tab of this.tabs) {
        // 跳过不需要持久化的标签页
        const keepAlive = tab.meta?.keepAlive;
        if (!keepAlive) {
          continue;
        }
        (tab.matched || []).forEach((t, i) => {
          if (i > 0) {
            cacheMap.add(t.name as string);
          }
        });

        const name = tab.name as string;
        cacheMap.add(name);
      }
      this.cachedTabs = cacheMap;
    },
  },
  getters: {
    /**
     * 固定标签列表，按 meta.affixTabOrder 升序排列，未设置序号的按 0 处理。
     * @returns 固定标签数组；没有固定标签时为空数组。
     */
    affixTabs(): TabDefinition[] {
      // 先筛出固定标签，再统一排序。
      const affixTabs = this.tabs.filter((tab) => isAffixTab(tab));

      return affixTabs.toSorted((a, b) => {
        const orderA = (a.meta?.affixTabOrder ?? 0) as number;
        const orderB = (b.meta?.affixTabOrder ?? 0) as number;
        return orderA - orderB;
      });
    },
    /**
     * 需要 keep-alive 的组件名集合。
     * @returns 组件名数组，从内部 Set 展开而来，修改它不会影响 store。
     */
    getCachedTabs(): string[] {
      return [...this.cachedTabs];
    },
    /**
     * 临时排除缓存的组件名集合，刷新标签期间由 refresh 系列方法写入。
     * @returns 组件名数组，修改它不会影响 store。
     */
    getExcludeCachedTabs(): string[] {
      return [...this.excludeCachedTabs];
    },
    /**
     * 标签右键菜单项列表。
     * @returns 内部数组本身（非拷贝），调用方不应直接修改。
     */
    getMenuList(): string[] {
      return this.menuList;
    },
    /**
     * 当前全部标签，固定标签排在前面，其余保持打开顺序。
     * @returns 标签数组的新副本，其中不含空值。
     */
    getTabs(): TabDefinition[] {
      // 非固定标签保持原有打开顺序，统一排在固定标签之后。
      const normalTabs = this.tabs.filter((tab) => !isAffixTab(tab));
      return [...this.affixTabs, ...normalTabs].filter(Boolean);
    },
  },
  persist: [
    // tabs不需要保存在localStorage
    {
      pick: ['tabs', 'visitHistory'],
      storage: sessionStorage,
    },
  ],
  /** store 初始状态：空标签列表、内置右键菜单项，访问历史栈上限由偏好与常量共同决定。 */
  state: (): TabbarState => ({
    visitHistory: createStack<string>(true, MAX_VISIT_HISTORY),
    cachedTabs: new Set(),
    dragEndIndex: 0,
    excludeCachedTabs: new Set(),
    menuList: [
      'close',
      'affix',
      'maximize',
      'reload',
      'open-in-new-window',
      'close-left',
      'close-right',
      'close-other',
      'close-all',
    ],
    renderRouteView: true,
    tabs: [],
    updateTime: Date.now(),
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useTabbarStore, hot));
}

/**
 * @zh_CN 克隆路由,防止路由被修改
 *
 * 入参在类型上是必填的标签定义，但标签也可能由外部构造（自定义标签、恢复的访问历史、
 * 热更新期间的旧状态）后以空值进入本函数；空值原样返回，交给调用方按自身契约处理，
 * 避免在这里抛出难以定位的解构错误。该契约由用例直接传入空值固定。
 *
 * @param route 待克隆的标签定义；为空时原样返回
 * @returns 克隆后的标签定义，入参为空时返回入参本身
 */
export function cloneTab(route: TabDefinition): TabDefinition {
  if (!route) {
    return route;
  }
  const { matched, meta, ...opt } = route;
  return {
    ...opt,
    // 匹配链只保留 meta/name/path：原始记录里的组件与守卫无法随状态持久化，提前裁剪掉。
    matched: (matched
      ? matched.map((item) => ({
          meta: item.meta,
          name: item.name,
          path: item.path,
        }))
      : undefined) as RouteRecordNormalized[],
    meta: {
      ...meta,
      newTabTitle: meta.newTabTitle,
    },
  };
}

/**
 * @zh_CN 判断命中的标签是否应计入"关闭其他"的待关闭集合
 *
 * 标签键由 `getTabKeyFromTab` 从标签自身推导，正常流程下必然能命中来源标签；这里仍把
 * "没有命中"当成显式契约处理：调用方传入未命中的结果时跳过该键，避免把空值写进待关闭
 * 集合而误关其它标签。命中时固定标签不参与关闭，交由标签栏自身的固定语义决定。
 *
 * @param tab 按标签键命中的标签；标签列表中不存在该键时为 undefined
 * @returns 命中且不是固定标签时为 true，类型上同时收窄为非空标签
 */
export function shouldCloseOtherTab(
  tab: TabDefinition | undefined,
): tab is TabDefinition {
  if (!tab) {
    return false;
  }
  return !isAffixTab(tab);
}

/**
 * 判断标签页是否为固定标签页（固定在标签栏、不参与批量关闭）。
 * @param tab 待判断的标签页
 * @returns 标签声明了固定（affixTab）时为 true
 */
function isAffixTab(tab: TabDefinition) {
  return tab?.meta?.affixTab ?? false;
}

/**
 * 判断标签是否要显示在标签栏：标签自身或其匹配链上任一记录声明了 meta.hideInTab 即隐藏。
 * @zh_CN 是否显示标签
 */
function isTabShown(tab: TabDefinition) {
  const matched = tab?.matched ?? [];
  return !tab.meta.hideInTab && matched.every((item) => !item.meta.hideInTab);
}

/**
 * 从route获取tab页的key
 * 优先取查询参数 pageKey（重复出现时取第一个）；否则按 meta.fullPathKey 决定用 path 还是 fullPath。
 * @param tab - 路由定位结果或路由记录。
 * @returns 解码后的键；含非法百分号转义时返回未解码的原串，不抛错。
 */
function getTabKey(tab: RouteLocationNormalized | RouteRecordNormalized) {
  const {
    fullPath,
    path,
    meta: { fullPathKey } = {},
    query = {},
  } = tab as RouteLocationNormalized;
  // pageKey可能是数组（查询参数重复时可能出现）
  const pageKey = Array.isArray(query.pageKey)
    ? query.pageKey[0]
    : query.pageKey;
  let rawKey;
  if (pageKey) {
    rawKey = pageKey;
  } else {
    rawKey = fullPathKey === false ? path : (fullPath ?? path);
  }
  try {
    return decodeURIComponent(rawKey);
  } catch {
    return rawKey;
  }
}

/**
 * 读取偏好设置里的访问历史开关；关闭时标签关闭逻辑不再维护 visitHistory。
 * @zh_CN 是否开启访问历史记录
 */
function isVisitHistory() {
  return preferences.tabbar.visitHistory;
}

/**
 * 从tab获取tab页的key
 * 如果tab没有key,那么就从route获取key
 * @param tab
 */
function getTabKeyFromTab(tab: TabDefinition): string {
  return tab.key ?? getTabKey(tab);
}

/**
 * 比较两个tab是否相等
 * @param a
 * @param b
 */
function equalTab(a: TabDefinition, b: TabDefinition) {
  return getTabKeyFromTab(a) === getTabKeyFromTab(b);
}

/**
 * 把路由记录裁剪成标签对象：只保留 meta、name、path，并补上按该路由推导的标签键。
 * 不携带 params、query 与 matched，因此只适合作为固定标签的初始数据。
 */
function routeToTab(route: RouteRecordNormalized) {
  return {
    meta: route.meta,
    name: route.name,
    path: route.path,
    key: getTabKey(route),
  } as TabDefinition;
}

export { getTabKey };

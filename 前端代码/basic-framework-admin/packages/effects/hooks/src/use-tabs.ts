/**
 * 标签页操作封装：把关闭左/右/其他、固定、刷新、新窗口打开
 * 等动作转发给标签栏 store，未传标签时默认作用于当前路由。
 *
 * 只做参数兜底与转发，标签数据与路由跳转仍由 store 维护。
 */
import type { ComputedRef } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';

import { useRoute, useRouter } from 'vue-router';

import { useTabbarStore } from '@vben/stores';

/**
 * 标签栏操作集合：关闭左/右/其他/当前标签、固定与取消固定、刷新、新窗口打开及标题重置。
 * 除按名称或键定位的操作外，未显式传入标签时一律以当前路由为目标。
 * @returns 上述操作方法；getTabDisableState 额外返回各操作在当前标签下的禁用状态。
 */
export function useTabs() {
  const router = useRouter();
  const route = useRoute();
  const tabbarStore = useTabbarStore();

  /** 关闭指定标签左侧的标签；不传时以当前路由为基准。 */
  async function closeLeftTabs(tab?: RouteLocationNormalized) {
    await tabbarStore.closeLeftTabs(tab || route);
  }

  /** 关闭全部可关闭的标签并跳转到剩余标签；固定标签不会被关闭。 */
  async function closeAllTabs() {
    await tabbarStore.closeAllTabs(router);
  }

  /** 关闭指定标签右侧的标签；不传时以当前路由为基准。 */
  async function closeRightTabs(tab?: RouteLocationNormalized) {
    await tabbarStore.closeRightTabs(tab || route);
  }

  /** 关闭除指定标签以外的其他标签；不传时保留当前路由对应的标签。 */
  async function closeOtherTabs(tab?: RouteLocationNormalized) {
    await tabbarStore.closeOtherTabs(tab || route);
  }

  /** 关闭指定标签并跳转到相邻标签；不传时关闭当前路由对应的标签。 */
  async function closeCurrentTab(tab?: RouteLocationNormalized) {
    await tabbarStore.closeTab(tab || route, router);
  }

  /** 固定指定标签，使其常驻标签栏且不可被批量关闭；不传时处理当前路由。 */
  async function pinTab(tab?: RouteLocationNormalized) {
    await tabbarStore.pinTab(tab || route);
  }

  /** 取消固定指定标签；不传时处理当前路由。 */
  async function unpinTab(tab?: RouteLocationNormalized) {
    await tabbarStore.unpinTab(tab || route);
  }

  /** 在固定与取消固定之间切换指定标签；不传时处理当前路由。 */
  async function toggleTabPin(tab?: RouteLocationNormalized) {
    await tabbarStore.toggleTabPin(tab || route);
  }

  /** 刷新指定名称的标签页；不传名称时刷新当前路由。 */
  async function refreshTab(name?: string) {
    await tabbarStore.refresh(name || router);
  }

  /** 在浏览器新窗口中打开指定标签的路由；不传时打开当前路由。 */
  async function openTabInNewWindow(tab?: RouteLocationNormalized) {
    await tabbarStore.openTabInNewWindow(tab || route);
  }

  /** 按标签唯一键关闭指定标签并跳转到相邻标签。 */
  async function closeTabByKey(key: string) {
    await tabbarStore.closeTabByKey(key, router);
  }

  /**
   * 设置当前标签页的标题
   *
   * @description 支持设置静态标题字符串或动态计算标题
   * @description 动态标题会在每次渲染时重新计算,适用于多语言或状态相关的标题
   *
   * @param title - 标题内容
   *   - 静态标题: 直接传入字符串
   *   - 动态标题: 传入 ComputedRef
   *
   * @example
   * // 静态标题
   * setTabTitle('标签页')
   *
   * // 动态标题(多语言)
   * setTabTitle(computed(() => t('page.title')))
   */
  async function setTabTitle(title: ComputedRef<string> | string) {
    tabbarStore.setUpdateTime();
    await tabbarStore.setTabTitle(route, title);
  }

  /** 把当前标签标题恢复为路由默认标题，并刷新标签更新时间以触发标签栏重算。 */
  async function resetTabTitle() {
    tabbarStore.setUpdateTime();
    await tabbarStore.resetTabTitle(route);
  }

  /**
   * 获取操作是否禁用
   * @param tab
   */
  function getTabDisableState(tab: RouteLocationNormalized = route) {
    const tabs = tabbarStore.getTabs;
    const affixTabs = tabbarStore.affixTabs;
    /** 目标标签在标签列表中的下标；找不到时为 -1，禁用判定按「非当前标签」处理。 */
    const index = tabs.findIndex((item) => item.path === tab.path);

    const disabled = tabs.length <= 1;

    const { meta } = tab;
    const affixTab = meta?.affixTab ?? false;
    const isCurrentTab = route.path === tab.path;

    // 当前处于最左侧或者减去固定标签页的数量等于0
    const disabledCloseLeft =
      index === 0 || index - affixTabs.length <= 0 || !isCurrentTab;

    const disabledCloseRight = !isCurrentTab || index === tabs.length - 1;

    const disabledCloseOther =
      disabled || !isCurrentTab || tabs.length - affixTabs.length <= 1;
    return {
      disabledCloseAll: disabled,
      disabledCloseCurrent: !!affixTab || disabled,
      disabledCloseLeft,
      disabledCloseOther,
      disabledCloseRight,
      disabledRefresh: !isCurrentTab,
    };
  }

  return {
    closeAllTabs,
    closeCurrentTab,
    closeLeftTabs,
    closeOtherTabs,
    closeRightTabs,
    closeTabByKey,
    getTabDisableState,
    openTabInNewWindow,
    pinTab,
    refreshTab,
    resetTabTitle,
    setTabTitle,
    toggleTabPin,
    unpinTab,
  };
}

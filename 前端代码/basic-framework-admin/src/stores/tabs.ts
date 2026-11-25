/**
 * 多标签页与 KeepAlive 缓存状态管理（1:1 对齐原 Vben 5 标签栏交互：
 * 图标、固定/取消固定、拖拽排序、左右/其他/全部关闭与局部刷新动效）。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';

export interface TabItem {
  path: string;
  title: string;
  name?: string;
  icon?: string;
  affix?: boolean;
  /** 概览等内置固定页不可取消固定 */
  permanentAffix?: boolean;
  keepAlive?: boolean;
}

export const useTabsStore = defineStore('tabs', () => {
  const dashboardTab: TabItem = {
    path: '/dashboard',
    title: '概览',
    name: 'DashboardView',
    icon: 'ep:odometer',
    affix: true,
    permanentAffix: true,
  };
  const tabs = ref<TabItem[]>([{ ...dashboardTab }]);
  const cachedNames = computed(() => [...new Set(tabs.value.flatMap((tab) =>
    tab.keepAlive !== false && tab.name ? [tab.name] : [],
  ))]);
  const refreshKey = ref(0);
  const refreshing = ref(false);
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function addTab(route: RouteLocationNormalizedLoaded) {
    if (!route.path || route.meta?.hideTab) return;
    const title = String(route.meta?.title || route.name || '未命名页面');
    const name = typeof route.name === 'string' ? route.name : undefined;
    const icon = typeof route.meta?.icon === 'string' ? route.meta.icon : undefined;
    const existing = tabs.value.find((t) => t.path === route.path);
    if (!existing) {
      const isAffix = Boolean(route.meta?.affix);
      tabs.value.push({
        path: route.path,
        title,
        name,
        icon,
        affix: isAffix,
        permanentAffix: isAffix,
        keepAlive: route.meta?.keepAlive !== false,
      });
    } else if (icon && !existing.icon) {
      existing.icon = icon;
    }
  }

  function removeTab(path: string): string | null {
    const idx = tabs.value.findIndex((t) => t.path === path);
    if (idx === -1 || tabs.value[idx]?.affix) return null;
    tabs.value.splice(idx, 1);
    const next = tabs.value[idx] ?? tabs.value[idx - 1];
    return next?.path ?? '/dashboard';
  }

  function togglePinTab(path: string) {
    const idx = tabs.value.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const target = tabs.value[idx];
    if (!target || target.permanentAffix) return;
    target.affix = !target.affix;
    // 固定标签保持在左侧固定区，非固定标签排在右侧
    const pinned = tabs.value.filter((t) => t.affix);
    const normal = tabs.value.filter((t) => !t.affix);
    tabs.value = [...pinned, ...normal];
  }

  function reorderTabs(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= tabs.value.length ||
      toIndex >= tabs.value.length
    ) {
      return;
    }
    const source = tabs.value[fromIndex];
    const target = tabs.value[toIndex];
    if (!source || !target || source.affix || target.affix) return;
    const list = [...tabs.value];
    const [moved] = list.splice(fromIndex, 1);
    if (!moved) return;
    list.splice(toIndex, 0, moved);
    tabs.value = list;
  }

  function closeLeftTabs(targetPath: string) {
    const idx = tabs.value.findIndex((t) => t.path === targetPath);
    if (idx <= 0) return;
    tabs.value = tabs.value.filter((t, i) => t.affix || i >= idx);
  }

  function closeRightTabs(targetPath: string) {
    const idx = tabs.value.findIndex((t) => t.path === targetPath);
    if (idx === -1 || idx >= tabs.value.length - 1) return;
    tabs.value = tabs.value.filter((t, i) => t.affix || i <= idx);
  }

  function closeOtherTabs(currentPath: string) {
    tabs.value = tabs.value.filter((t) => t.affix || t.path === currentPath);
  }

  function closeAllTabs() {
    tabs.value = tabs.value.filter((t) => t.affix);
  }

  function triggerRefresh() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    refreshing.value = true;
    refreshKey.value += 1;
    refreshTimer = setTimeout(() => {
      refreshing.value = false;
      refreshTimer = null;
    }, 280);
  }

  function reset() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    refreshing.value = false;
    tabs.value = [{ ...dashboardTab }];
  }

  return {
    tabs,
    cachedNames,
    refreshKey,
    refreshing,
    addTab,
    removeTab,
    togglePinTab,
    reorderTabs,
    closeLeftTabs,
    closeRightTabs,
    closeOtherTabs,
    closeAllTabs,
    triggerRefresh,
    reset,
  };
});

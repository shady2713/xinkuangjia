/**
 * 多标签页与 KeepAlive 缓存状态管理（对齐原 Vben 5 标签栏交互：图标、左右/其他/全部关闭与局部刷新）。
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
  keepAlive?: boolean;
}

export const useTabsStore = defineStore('tabs', () => {
  const dashboardTab: TabItem = {
    path: '/dashboard',
    title: '概览',
    name: 'DashboardView',
    icon: 'ep:odometer',
    affix: true,
  };
  const tabs = ref<TabItem[]>([{ ...dashboardTab }]);
  const cachedNames = computed(() => [...new Set(tabs.value.flatMap((tab) =>
    tab.keepAlive !== false && tab.name ? [tab.name] : [],
  ))]);
  const refreshKey = ref(0);

  function addTab(route: RouteLocationNormalizedLoaded) {
    if (!route.path || route.meta?.hideTab) return;
    const title = String(route.meta?.title || route.name || '未命名页面');
    const name = typeof route.name === 'string' ? route.name : undefined;
    const icon = typeof route.meta?.icon === 'string' ? route.meta.icon : undefined;
    const existing = tabs.value.find((t) => t.path === route.path);
    if (!existing) {
      tabs.value.push({
        path: route.path,
        title,
        name,
        icon,
        affix: Boolean(route.meta?.affix),
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
    refreshKey.value += 1;
  }

  function reset() {
    tabs.value = [{ ...dashboardTab }];
  }

  return {
    tabs,
    cachedNames,
    refreshKey,
    addTab,
    removeTab,
    closeLeftTabs,
    closeRightTabs,
    closeOtherTabs,
    closeAllTabs,
    triggerRefresh,
    reset,
  };
});

/**
 * 多标签页与 KeepAlive 缓存状态管理（对齐原 Vben 5 标签栏交互：图标、左右/其他/全部关闭与局部刷新）。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';

export interface TabItem {
  path: string;
  title: string;
  name?: string;
  icon?: string;
  affix?: boolean;
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>([
    {
      path: '/dashboard',
      title: '概览',
      name: 'DashboardView',
      icon: 'ep:odometer',
      affix: true,
    },
  ]);
  const cachedNames = ref<string[]>(['DashboardView']);
  const refreshKey = ref(0);

  function syncCachedNames() {
    cachedNames.value = tabs.value
      .map((t) => t.name)
      .filter((n): n is string => Boolean(n));
  }

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
      });
    } else if (icon && !existing.icon) {
      existing.icon = icon;
    }
    if (name && route.meta?.keepAlive !== false && !cachedNames.value.includes(name)) {
      cachedNames.value.push(name);
    }
  }

  function removeTab(path: string): string | null {
    const idx = tabs.value.findIndex((t) => t.path === path);
    if (idx === -1 || tabs.value[idx]?.affix) return null;
    tabs.value.splice(idx, 1);
    syncCachedNames();
    const next = tabs.value[idx] ?? tabs.value[idx - 1];
    return next?.path ?? '/dashboard';
  }

  function closeLeftTabs(targetPath: string) {
    const idx = tabs.value.findIndex((t) => t.path === targetPath);
    if (idx <= 0) return;
    tabs.value = tabs.value.filter((t, i) => t.affix || i >= idx);
    syncCachedNames();
  }

  function closeRightTabs(targetPath: string) {
    const idx = tabs.value.findIndex((t) => t.path === targetPath);
    if (idx === -1 || idx >= tabs.value.length - 1) return;
    tabs.value = tabs.value.filter((t, i) => t.affix || i <= idx);
    syncCachedNames();
  }

  function closeOtherTabs(currentPath: string) {
    tabs.value = tabs.value.filter((t) => t.affix || t.path === currentPath);
    syncCachedNames();
  }

  function closeAllTabs() {
    tabs.value = tabs.value.filter((t) => t.affix);
    syncCachedNames();
  }

  function triggerRefresh() {
    refreshKey.value += 1;
  }

  function reset() {
    tabs.value = [
      {
        path: '/dashboard',
        title: '概览',
        name: 'DashboardView',
        icon: 'ep:odometer',
        affix: true,
      },
    ];
    cachedNames.value = ['DashboardView'];
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

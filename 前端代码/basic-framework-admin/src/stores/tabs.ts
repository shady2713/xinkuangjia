/**
 * 多标签页与 KeepAlive 缓存状态管理。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';

export interface TabItem {
  path: string;
  title: string;
  name?: string;
  affix?: boolean;
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>([
    { path: '/dashboard', title: '概览', name: 'DashboardView', affix: true },
  ]);
  const cachedNames = ref<string[]>(['DashboardView']);
  const refreshKey = ref(0);

  function addTab(route: RouteLocationNormalizedLoaded) {
    if (!route.path || route.meta?.hideTab) return;
    const title = String(route.meta?.title || route.name || '未命名页面');
    const name = typeof route.name === 'string' ? route.name : undefined;
    const exists = tabs.value.some((t) => t.path === route.path);
    if (!exists) {
      tabs.value.push({
        path: route.path,
        title,
        name,
        affix: Boolean(route.meta?.affix),
      });
    }
    if (name && route.meta?.keepAlive !== false && !cachedNames.value.includes(name)) {
      cachedNames.value.push(name);
    }
  }

  function removeTab(path: string): string | null {
    const idx = tabs.value.findIndex((t) => t.path === path);
    if (idx === -1 || tabs.value[idx]?.affix) return null;
    const [removed] = tabs.value.splice(idx, 1);
    if (removed?.name) {
      cachedNames.value = cachedNames.value.filter((n) => n !== removed.name);
    }
    const next = tabs.value[idx] ?? tabs.value[idx - 1];
    return next?.path ?? '/dashboard';
  }

  function closeOtherTabs(currentPath: string) {
    tabs.value = tabs.value.filter((t) => t.affix || t.path === currentPath);
    cachedNames.value = tabs.value
      .map((t) => t.name)
      .filter((n): n is string => Boolean(n));
  }

  function closeAllTabs() {
    tabs.value = tabs.value.filter((t) => t.affix);
    cachedNames.value = tabs.value
      .map((t) => t.name)
      .filter((n): n is string => Boolean(n));
  }

  function triggerRefresh() {
    refreshKey.value += 1;
  }

  function reset() {
    tabs.value = [
      { path: '/dashboard', title: '概览', name: 'DashboardView', affix: true },
    ];
    cachedNames.value = ['DashboardView'];
  }

  return {
    tabs,
    cachedNames,
    refreshKey,
    addTab,
    removeTab,
    closeOtherTabs,
    closeAllTabs,
    triggerRefresh,
    reset,
  };
});

<script setup lang="ts">
/**
 * 1:1 复刻原 Vben Admin 5 经典浅色布局：
 * - 左侧 224px 白底圆角胶囊菜单（折叠 60px，折叠展开记忆父菜单展开状态，底部折叠切换）
 * - 顶部 50px 白底导航栏（侧栏切换、刷新、带图标面包屑、全屏、用户头像下拉）
 * - 38px Chrome 风格曲线多标签页栏（支持右键菜单、局部刷新与内容区最大化）
 * - 浅灰画布主内容区 + Vben 5 fade-slide 切换动画
 */
import {
  Expand,
  Fold,
  FullScreen,
  Odometer,
  Refresh,
  SwitchButton,
  User as UserIcon,
} from '@element-plus/icons-vue';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import type { MenuRouteItem } from '@/api/auth';
import MenuIcon from '@/components/MenuIcon.vue';
import { getAppConfig } from '@/config/app';
import SidebarMenuItem from '@/layout/SidebarMenuItem.vue';
import TabsChrome from '@/layout/TabsChrome.vue';
import { clearDynamicRoutes } from '@/router';
import { useAppStore } from '@/stores/app';
import { useDictStore } from '@/stores/dict';
import { useTabsStore } from '@/stores/tabs';
import { useUserStore } from '@/stores/user';
import { confirmAction } from '@/utils/confirm';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const userStore = useUserStore();
const tabsStore = useTabsStore();
const dictStore = useDictStore();

const { appTitle } = getAppConfig();
const logoUrl = `${import.meta.env.BASE_URL}brand-logo.svg`;
const contentMaximized = ref(false);

const activeMenu = computed(() => route.path);

/** 根据当前路由路径收集父级目录路径，保证侧边栏折叠再展开后自动还原展开状态 */
function findParentPaths(
  items: MenuRouteItem[],
  targetPath: string,
  parentPath = '',
  trail: string[] = [],
): string[] | null {
  for (const item of items) {
    const raw = item.path || '';
    const full = raw.startsWith('/')
      ? raw
      : `${parentPath.replace(/\/$/, '')}/${raw}`.replace(/\/+/g, '/');
    if (full === targetPath) {
      return trail;
    }
    if (item.children && item.children.length > 0) {
      const found = findParentPaths(item.children, targetPath, full, [...trail, full]);
      if (found) return found;
    }
  }
  return null;
}

const defaultOpeneds = computed(() => {
  const parents = findParentPaths(userStore.menus, route.path);
  return parents && parents.length > 0 ? parents : ['/system'];
});

interface BreadcrumbNode {
  title: string;
  icon?: string;
}

function findBreadcrumbTrail(
  items: MenuRouteItem[],
  targetPath: string,
  parentPath = '',
  trail: BreadcrumbNode[] = [],
): BreadcrumbNode[] | null {
  for (const item of items) {
    const raw = item.path || '';
    const full = raw.startsWith('/')
      ? raw
      : `${parentPath.replace(/\/$/, '')}/${raw}`.replace(/\/+/g, '/');
    const nextTrail = [...trail, { title: item.name, icon: item.icon }];
    if (full === targetPath) {
      return nextTrail;
    }
    if (item.children && item.children.length > 0) {
      const found = findBreadcrumbTrail(item.children, targetPath, full, nextTrail);
      if (found) return found;
    }
  }
  return null;
}

const breadcrumbs = computed<BreadcrumbNode[]>(() => {
  if (route.path === '/dashboard') {
    return [{ title: '概览', icon: 'ep:odometer' }];
  }
  const matched = findBreadcrumbTrail(userStore.menus, route.path);
  if (matched && matched.length > 0) {
    return matched;
  }
  return [
    { title: '概览', icon: 'ep:odometer' },
    ...(route.meta?.title ? [{ title: String(route.meta.title) }] : []),
  ];
});

watch(
  () => route.fullPath,
  () => {
    tabsStore.addTab(route);
  },
  { immediate: true },
);

function handleCloseTab(path: string) {
  const nextPath = tabsStore.removeTab(path);
  if (route.path === path && nextPath) {
    void router.push(nextPath);
  }
}

function handleCloseLeft(path: string) {
  tabsStore.closeLeftTabs(path);
  if (!tabsStore.tabs.some((t) => t.path === route.path)) {
    void router.push(path);
  }
}

function handleCloseRight(path: string) {
  tabsStore.closeRightTabs(path);
  if (!tabsStore.tabs.some((t) => t.path === route.path)) {
    void router.push(path);
  }
}

function handleCloseOther(path: string) {
  tabsStore.closeOtherTabs(path);
  if (route.path !== path) {
    void router.push(path);
  }
}

function handleCloseAll() {
  tabsStore.closeAllTabs();
  if (route.path !== '/dashboard') {
    void router.push('/dashboard');
  }
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.();
  } else {
    void document.exitFullscreen?.();
  }
}

async function handleUserCommand(cmd: string) {
  if (cmd === 'profile') {
    await router.push('/profile');
    return;
  }
  if (cmd === 'logout') {
    await confirmAction('确定要退出当前登录账号吗？', {
      title: '退出登录',
      confirmText: '退出登录',
      cancelText: '取消',
    });
    await userStore.logout();
    clearDynamicRoutes();
    tabsStore.reset();
    dictStore.reset();
    await router.replace('/login');
  }
}
</script>

<template>
  <div class="flex h-full w-full overflow-hidden">
    <!-- 左侧白底侧边栏 -->
    <aside
      v-show="!contentMaximized"
      class="flex h-full shrink-0 flex-col border-r border-[#e4e4e7] bg-white transition-[width] duration-200"
      :style="{
        width: appStore.sidebarCollapsed
          ? 'var(--bf-sidebar-collapsed-width)'
          : 'var(--bf-sidebar-width)',
      }"
    >
      <div
        class="flex h-[50px] shrink-0 cursor-pointer items-center gap-2.5 border-b border-transparent px-3.5"
        :class="{ 'justify-center px-0': appStore.sidebarCollapsed }"
        @click="router.push('/dashboard')"
      >
        <img :src="logoUrl" :alt="appTitle" class="h-8 w-8 shrink-0 rounded-lg" />
        <span
          v-show="!appStore.sidebarCollapsed"
          class="truncate text-[16px] font-semibold tracking-tight text-[#18181b]"
        >
          {{ appTitle }}
        </span>
      </div>

      <el-scrollbar class="flex-1">
        <el-menu
          :key="appStore.sidebarCollapsed ? 'collapsed' : 'expanded'"
          :default-active="activeMenu"
          :default-openeds="appStore.sidebarCollapsed ? [] : defaultOpeneds"
          :collapse="appStore.sidebarCollapsed"
          :collapse-transition="false"
          unique-opened
          router
          class="bf-sidebar-menu"
        >
          <el-menu-item index="/dashboard">
            <el-icon><Odometer /></el-icon>
            <template #title><span>概览</span></template>
          </el-menu-item>
          <SidebarMenuItem
            v-for="menu in userStore.menus"
            :key="menu.id"
            :item="menu"
          />
        </el-menu>
      </el-scrollbar>

      <!-- 侧边栏底部折叠按钮（对齐 Vben 5 sidebar.collapsedButton） -->
      <div class="flex h-10 shrink-0 items-center justify-center border-t border-[#f1f2f5] px-2">
        <button
          type="button"
          class="flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#18181b]"
          :title="appStore.sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
          @click="appStore.toggleSidebar()"
        >
          <el-icon :size="15">
            <Expand v-if="appStore.sidebarCollapsed" />
            <Fold v-else />
          </el-icon>
          <span v-show="!appStore.sidebarCollapsed" class="text-xs">收起菜单</span>
        </button>
      </div>
    </aside>

    <!-- 右侧主区 -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- 顶部导航栏 (50px) -->
      <header
        v-show="!contentMaximized"
        class="flex h-[50px] shrink-0 items-center justify-between border-b border-[#e4e4e7] bg-white px-3"
      >
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#475569] transition hover:bg-[#f4f4f5] hover:text-[#18181b]"
            :title="appStore.sidebarCollapsed ? '展开菜单' : '折叠菜单'"
            @click="appStore.toggleSidebar()"
          >
            <el-icon :size="17">
              <Expand v-if="appStore.sidebarCollapsed" />
              <Fold v-else />
            </el-icon>
          </button>

          <button
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#475569] transition hover:bg-[#f4f4f5] hover:text-[#18181b]"
            title="刷新当前页"
            @click="tabsStore.triggerRefresh()"
          >
            <el-icon :size="16"><Refresh /></el-icon>
          </button>

          <el-breadcrumb separator="/" class="ml-1.5">
            <el-breadcrumb-item v-for="crumb in breadcrumbs" :key="crumb.title">
              <span class="inline-flex items-center gap-1 text-[13px]">
                <MenuIcon v-if="crumb.icon" :name="crumb.icon" class="!text-[14px] text-[#64748b]" />
                <span>{{ crumb.title }}</span>
              </span>
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#475569] transition hover:bg-[#f4f4f5] hover:text-[#18181b]"
            title="全屏切换"
            @click="toggleFullscreen"
          >
            <el-icon :size="16"><FullScreen /></el-icon>
          </button>

          <el-dropdown trigger="click" @command="handleUserCommand">
            <div
              class="flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1.5 pr-2.5 transition hover:bg-[#f4f4f5]"
            >
              <el-avatar
                :size="28"
                :src="userStore.userInfo?.avatar || undefined"
                class="!bg-[#006be6] text-xs font-semibold text-white"
              >
                {{ (userStore.userInfo?.nickname || userStore.userInfo?.username || 'A').slice(0, 1).toUpperCase() }}
              </el-avatar>
              <span class="max-w-[120px] truncate text-[13px] font-medium text-[#1f2937]">
                {{ userStore.userInfo?.nickname || userStore.userInfo?.username || '管理员' }}
              </span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><UserIcon /></el-icon>
                  个人中心
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <!-- Chrome 曲线风格多标签页栏 (38px) -->
      <TabsChrome
        :tabs="tabsStore.tabs"
        :active-path="route.path"
        :content-maximized="contentMaximized"
        @select="(p) => router.push(p)"
        @close="handleCloseTab"
        @close-left="handleCloseLeft"
        @close-right="handleCloseRight"
        @close-other="handleCloseOther"
        @close-all="handleCloseAll"
        @refresh="tabsStore.triggerRefresh()"
        @toggle-maximize="contentMaximized = !contentMaximized"
      />

      <!-- 浅灰底主内容区 -->
      <main class="min-h-0 flex-1 overflow-auto bg-[var(--bf-bg-deep)] p-4">
        <router-view v-slot="{ Component }">
          <transition name="bf-fade-slide" mode="out-in">
            <keep-alive :include="tabsStore.cachedNames">
              <component :is="Component" :key="`${route.path}-${tabsStore.refreshKey}`" />
            </keep-alive>
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

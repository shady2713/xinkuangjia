<script setup lang="ts">
/**
 * 1:1 复刻原管理平台经典浅色布局：
 * 左侧白底可折叠侧边栏 + 顶部 50px 白底面包屑/用户信息栏 + 38px 多标签页栏 + 浅灰底主内容区。
 */
import {
  Close,
  Expand,
  Fold,
  FullScreen,
  Odometer,
  Refresh,
  SwitchButton,
  User as UserIcon,
} from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { getAppConfig } from '@/config/app';
import SidebarMenuItem from '@/layout/SidebarMenuItem.vue';
import { clearDynamicRoutes } from '@/router';
import { useAppStore } from '@/stores/app';
import { useDictStore } from '@/stores/dict';
import { useTabsStore } from '@/stores/tabs';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const userStore = useUserStore();
const tabsStore = useTabsStore();
const dictStore = useDictStore();

const { appTitle } = getAppConfig();
const logoUrl = `${import.meta.env.BASE_URL}brand-logo.svg`;

const activeMenu = computed(() => route.path);

const breadcrumbs = computed(() => {
  const list: string[] = [];
  if (route.path !== '/dashboard') {
    list.push('首页');
  }
  if (route.meta?.title) {
    list.push(String(route.meta.title));
  }
  return list;
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
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消',
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
      class="flex h-full shrink-0 flex-col border-r border-[#e4e4e7] bg-white transition-[width] duration-200"
      :style="{
        width: appStore.sidebarCollapsed
          ? 'var(--bf-sidebar-collapsed-width)'
          : 'var(--bf-sidebar-width)',
      }"
    >
      <div
        class="flex h-[50px] shrink-0 cursor-pointer items-center gap-2.5 px-4"
        @click="router.push('/dashboard')"
      >
        <img :src="logoUrl" :alt="appTitle" class="h-8 w-8 shrink-0" />
        <span
          v-show="!appStore.sidebarCollapsed"
          class="truncate text-[16px] font-semibold text-[#1f2937]"
        >
          {{ appTitle }}
        </span>
      </div>

      <el-scrollbar class="flex-1">
        <el-menu
          :default-active="activeMenu"
          :collapse="appStore.sidebarCollapsed"
          :collapse-transition="false"
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
    </aside>

    <!-- 右侧主区 -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- 顶部导航栏 (50px) -->
      <header
        class="flex h-[50px] shrink-0 items-center justify-between border-b border-[#e4e4e7] bg-white px-4"
      >
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#475569] hover:bg-[#f4f4f5]"
            :title="appStore.sidebarCollapsed ? '展开菜单' : '折叠菜单'"
            @click="appStore.toggleSidebar()"
          >
            <el-icon :size="18">
              <Expand v-if="appStore.sidebarCollapsed" />
              <Fold v-else />
            </el-icon>
          </button>

          <el-breadcrumb separator="/">
            <el-breadcrumb-item v-for="crumb in breadcrumbs" :key="crumb">
              {{ crumb }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="flex items-center gap-2">
          <el-tooltip content="刷新当前页" placement="bottom">
            <button
              type="button"
              class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#475569] hover:bg-[#f4f4f5]"
              @click="tabsStore.triggerRefresh()"
            >
              <el-icon :size="16"><Refresh /></el-icon>
            </button>
          </el-tooltip>

          <el-tooltip content="全屏切换" placement="bottom">
            <button
              type="button"
              class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#475569] hover:bg-[#f4f4f5]"
              @click="toggleFullscreen"
            >
              <el-icon :size="16"><FullScreen /></el-icon>
            </button>
          </el-tooltip>

          <el-dropdown trigger="click" @command="handleUserCommand">
            <div
              class="flex cursor-pointer items-center gap-2 rounded-full py-1 pr-2.5 pl-1 hover:bg-[#f4f4f5]"
            >
              <el-avatar
                :size="30"
                :src="userStore.userInfo?.avatar || undefined"
                class="bg-[#006be6] text-xs text-white"
              >
                {{
                  (userStore.userInfo?.nickname || userStore.userInfo?.username || 'A')
                    .slice(0, 1)
                    .toUpperCase()
                }}
              </el-avatar>
              <span class="max-w-[120px] truncate text-sm font-medium text-[#1f2937]">
                {{ userStore.userInfo?.nickname || userStore.userInfo?.username || '管理员' }}
              </span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><UserIcon /></el-icon>
                  个人中心
                </el-dropdown-item>
                <el-dropdown-item divided command="logout">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <!-- 多标签页栏 (38px) -->
      <div
        class="flex h-[38px] shrink-0 items-center justify-between border-b border-[#e4e4e7] bg-white px-3"
      >
        <div class="flex flex-1 items-center gap-1 overflow-x-auto">
          <div
            v-for="tab in tabsStore.tabs"
            :key="tab.path"
            class="group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs transition"
            :class="
              tab.path === route.path
                ? 'bg-[#e6f0fc] font-medium text-[#006be6]'
                : 'text-[#64748b] hover:bg-[#f4f4f5] hover:text-[#1f2937]'
            "
            @click="router.push(tab.path)"
          >
            <span>{{ tab.title }}</span>
            <el-icon
              v-if="!tab.affix"
              :size="12"
              class="rounded-full p-0.5 hover:bg-black/10"
              @click.stop="handleCloseTab(tab.path)"
            >
              <Close />
            </el-icon>
          </div>
        </div>

        <el-dropdown
          trigger="click"
          @command="
            (cmd: string) =>
              cmd === 'others'
                ? tabsStore.closeOtherTabs(route.path)
                : (tabsStore.closeAllTabs(), router.push('/dashboard'))
          "
        >
          <el-button link size="small" class="ml-2 text-xs text-[#64748b]">
            标签操作
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="others">关闭其他标签</el-dropdown-item>
              <el-dropdown-item command="all">关闭全部标签</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <!-- 主内容画布 -->
      <main class="flex-1 overflow-auto bg-[#f1f3f6] p-4">
        <router-view v-slot="{ Component }">
          <keep-alive :include="tabsStore.cachedNames">
            <component :is="Component" :key="`${route.fullPath}-${tabsStore.refreshKey}`" />
          </keep-alive>
        </router-view>
      </main>
    </div>
  </div>
</template>

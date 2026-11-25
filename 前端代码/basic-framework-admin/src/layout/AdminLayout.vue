<script setup lang="ts">
/**
 * 1:1 复刻原 Vben Admin 5 经典浅色布局与交互动效：
 * - 全套 Lucide 细线条图标（@lucide/vue）
 * - 左侧 224px 白底圆角胶囊菜单（折叠 60px，底部左下 «/» 折叠小方块 + 右下 Pin/PinOff 悬停展开开关）
 * - 顶部 50px 白底导航栏（侧栏切换、刷新旋转反馈、skewX 动效面包屑、全屏动态图标、绿点圆形头像大卡片下拉）
 * - 内置锁屏弹窗 + 模糊时钟锁屏遮罩（Alt+L 锁屏 / Alt+Q 退出）
 * - 38px Chrome 曲线多标签页栏 + 视口自适应主内容区（fade-slide 0.3s ±30px + 四点过渡加载层）
 */
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Maximize,
  Menu as MenuLucide,
  Minimize,
  Pin,
  PinOff,
  RotateCw,
  UserRound,
} from '@lucide/vue';
import { ElMessage, type MenuInstance } from 'element-plus';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import type { MenuRouteItem } from '@/api/auth';
import FormDialog from '@/components/FormDialog.vue';
import MenuIcon from '@/components/MenuIcon.vue';
import { getAppConfig } from '@/config/app';
import LockScreen from '@/layout/LockScreen.vue';
import SidebarMenuItem from '@/layout/SidebarMenuItem.vue';
import TabsChrome from '@/layout/TabsChrome.vue';
import { returnToLoginAfter } from '@/router';
import { useAppStore } from '@/stores/app';
import { useTabsStore } from '@/stores/tabs';
import { useUserStore } from '@/stores/user';
import { confirmCurrentSession } from '@/utils/confirm';
import { sessionId } from '@/utils/token';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const userStore = useUserStore();
const tabsStore = useTabsStore();

const { appTitle } = getAppConfig();
const logoUrl = `${import.meta.env.BASE_URL}brand-logo.svg`;
const contentMaximized = ref(false);
const isFullscreen = ref(false);
const sidebarHovering = ref(false);
const menuRef = ref<MenuInstance | null>(null);
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

// 锁屏设置弹窗
const lockModalVisible = ref(false);
const lockPasswordInput = ref('');

/** 折叠态下且开启 expandOnHover 时，鼠标悬停自动浮层展开 */
const effectiveCollapsed = computed(
  () => appStore.sidebarCollapsed && !(appStore.sidebarExpandOnHover && sidebarHovering.value),
);
const isFloatingHoverExpand = computed(
  () => appStore.sidebarCollapsed && appStore.sidebarExpandOnHover && sidebarHovering.value,
);

const activeMenu = computed(() => route.path);

const displayName = computed(
  () => userStore.userInfo?.nickname || userStore.userInfo?.username || '管理员',
);
const displaySubtitle = computed(
  () => userStore.userInfo?.email || userStore.userInfo?.username || 'enterprise-admin',
);
const roleBadgeText = computed(() =>
  userStore.roles.includes('super_admin') ? 'Pro' : 'Admin',
);

const isMac = computed(() =>
  typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent),
);
const altLabel = computed(() => (isMac.value ? '⌥' : 'Alt'));

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

watch(effectiveCollapsed, async (collapsed) => {
  if (!collapsed) {
    await nextTick();
    for (const parentPath of defaultOpeneds.value) {
      menuRef.value?.open(parentPath);
    }
  }
});

function handleSidebarMouseEnter() {
  if (!appStore.sidebarCollapsed || !appStore.sidebarExpandOnHover) return;
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  hoverTimer = setTimeout(() => {
    sidebarHovering.value = true;
    hoverTimer = null;
  }, 120);
}

function handleSidebarMouseLeave() {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  sidebarHovering.value = false;
}

function handleToggleSidebar() {
  sidebarHovering.value = false;
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  appStore.toggleSidebar();
}

interface BreadcrumbNode {
  title: string;
  icon?: string;
  path?: string;
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
    const nextTrail = [
      ...trail,
      {
        title: item.name,
        icon: item.icon,
        path: item.children && item.children.length > 0 ? undefined : full,
      },
    ];
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
    return [{ title: '概览', icon: 'ep:odometer', path: '/dashboard' }];
  }
  const matched = findBreadcrumbTrail(userStore.menus, route.path);
  if (matched && matched.length > 0) {
    return matched;
  }
  return [
    { title: '概览', icon: 'ep:odometer', path: '/dashboard' },
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

watch(sessionId, () => {
  lockModalVisible.value = false;
  lockPasswordInput.value = '';
  appStore.resetLockScreen();
});

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

function syncFullscreenState() {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.();
  } else {
    void document.exitFullscreen?.();
  }
}

function openLockModal() {
  lockPasswordInput.value = '';
  lockModalVisible.value = true;
}

function submitLockScreen() {
  const pwd = lockPasswordInput.value.trim();
  if (!pwd) {
    ElMessage.warning('请设置锁屏密码');
    return;
  }
  lockModalVisible.value = false;
  lockPasswordInput.value = '';
  appStore.lockScreen(pwd);
}

function handleUnlock(password: string, done: (ok: boolean) => void) {
  done(appStore.unlockScreen(password));
}

async function handleLockLogout() {
  appStore.resetLockScreen();
  await returnToLoginAfter(userStore.logout);
}

async function promptLogout() {
  const confirmed = await confirmCurrentSession('确定要退出当前登录账号吗？', {
    title: '提示',
    confirmText: '确定',
    cancelText: '取消',
  });
  if (confirmed) {
    appStore.resetLockScreen();
    await returnToLoginAfter(userStore.logout);
  }
}

async function handleUserCommand(cmd: string) {
  if (cmd === 'profile') {
    await router.push('/profile');
    return;
  }
  if (cmd === 'lock') {
    openLockModal();
    return;
  }
  if (cmd === 'logout') {
    await promptLogout();
  }
}

function handleGlobalShortcut(event: KeyboardEvent) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return;
  }
  if (event.code === 'KeyL' && !appStore.isLockScreen) {
    event.preventDefault();
    openLockModal();
  } else if (event.code === 'KeyQ' && !appStore.isLockScreen) {
    event.preventDefault();
    void promptLogout();
  }
}

onMounted(() => {
  document.addEventListener('fullscreenchange', syncFullscreenState);
  window.addEventListener('keydown', handleGlobalShortcut);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState);
  window.removeEventListener('keydown', handleGlobalShortcut);
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
});
</script>

<template>
  <div class="relative flex h-full w-full overflow-hidden">
    <!-- 侧边栏占位容器：折叠悬停临时展开时不挤压右侧表格与图表 -->
    <div
      v-show="!contentMaximized"
      class="relative h-full shrink-0 transition-[width] duration-200 ease-in-out"
      :style="{
        width: appStore.sidebarCollapsed
          ? 'var(--bf-sidebar-collapsed-width)'
          : 'var(--bf-sidebar-width)',
      }"
    >
      <!-- 左侧白底侧边栏 -->
      <aside
        class="absolute top-0 left-0 flex h-full flex-col border-r border-[#e4e4e7] bg-white transition-[width,box-shadow] duration-200 ease-in-out"
        :class="isFloatingHoverExpand ? 'z-30 shadow-xl' : 'z-10'"
        :style="{
          width: effectiveCollapsed
            ? 'var(--bf-sidebar-collapsed-width)'
            : 'var(--bf-sidebar-width)',
        }"
        @mouseenter="handleSidebarMouseEnter"
        @mouseleave="handleSidebarMouseLeave"
      >
        <div
          class="flex h-[50px] shrink-0 cursor-pointer items-center gap-2.5 overflow-hidden px-3.5 transition-all duration-200"
          :class="{ 'justify-center px-0': effectiveCollapsed }"
          @click="router.push('/dashboard')"
        >
          <img
            :src="logoUrl"
            :alt="appTitle"
            class="h-8 w-8 shrink-0 rounded-lg transition-transform duration-200 hover:scale-105"
          />
          <span
            v-show="!effectiveCollapsed"
            class="truncate text-[16px] font-semibold tracking-tight text-[#18181b] transition-opacity duration-200"
          >
            {{ appTitle }}
          </span>
        </div>

        <div class="bf-sidebar-scroll-wrap relative min-h-0 flex-1">
          <el-scrollbar class="h-full">
            <el-menu
              ref="menuRef"
              :default-active="activeMenu"
              :default-openeds="defaultOpeneds"
              :collapse="effectiveCollapsed"
              :collapse-transition="false"
              unique-opened
              router
              class="bf-sidebar-menu"
            >
              <el-menu-item index="/dashboard">
                <el-icon class="bf-lucide-icon">
                  <LayoutDashboard :stroke-width="1.75" />
                </el-icon>
                <template #title><span>概览</span></template>
              </el-menu-item>
              <SidebarMenuItem
                v-for="menu in userStore.menus"
                :key="menu.id"
                :item="menu"
              />
            </el-menu>
          </el-scrollbar>
        </div>

        <!-- 侧边栏底部双小方块（1:1 对齐原版 Vben 5：左下 «/» 折叠 + 右下 Pin/PinOff 悬停展开开关） -->
        <div class="relative h-[42px] shrink-0">
          <button
            type="button"
            class="absolute bottom-2 left-3 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-[#f4f4f5] text-[#71717a] transition hover:bg-[#e4e4e7] hover:text-[#18181b] active:scale-95"
            :title="appStore.sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
            @click.stop="handleToggleSidebar"
          >
            <ChevronsRight v-if="appStore.sidebarCollapsed" class="h-4 w-4" :stroke-width="1.75" />
            <ChevronsLeft v-else class="h-4 w-4" :stroke-width="1.75" />
          </button>

          <button
            v-if="!effectiveCollapsed"
            type="button"
            class="absolute right-3 bottom-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded bg-[#f4f4f5] text-[#71717a] transition hover:bg-[#e4e4e7] hover:text-[#18181b] active:scale-95"
            :title="appStore.sidebarExpandOnHover ? '折叠时悬停自动展开（已开启）' : '折叠时悬停自动展开（已关闭）'"
            @click.stop="appStore.toggleSidebarExpandOnHover()"
          >
            <Pin v-if="appStore.sidebarExpandOnHover" class="h-3.5 w-3.5" :stroke-width="1.75" />
            <PinOff v-else class="h-3.5 w-3.5" :stroke-width="1.75" />
          </button>
        </div>
      </aside>
    </div>

    <!-- 右侧主区 -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- 顶部导航栏 (50px) -->
      <header
        v-show="!contentMaximized"
        class="flex h-[50px] shrink-0 items-center justify-between border-b border-[#e4e4e7] bg-white px-2.5"
      >
        <div class="flex min-w-0 items-center gap-1">
          <button
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#3f3f46] transition hover:bg-[#f4f4f5] hover:text-[#18181b] active:scale-95"
            :title="appStore.sidebarCollapsed ? '展开菜单' : '折叠菜单'"
            @click="handleToggleSidebar"
          >
            <MenuLucide class="h-4 w-4" :stroke-width="1.75" />
          </button>

          <button
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[#3f3f46] transition hover:bg-[#f4f4f5] hover:text-[#18181b] active:scale-95"
            title="刷新当前页"
            @click="tabsStore.triggerRefresh()"
          >
            <RotateCw
              class="h-4 w-4"
              :class="{ 'animate-spin': tabsStore.refreshing }"
              :stroke-width="1.75"
            />
          </button>

          <!-- Vben 5 经典 skewX 滑入动效面包屑 -->
          <nav aria-label="面包屑导航" class="ml-1.5 hidden min-w-0 items-center lg:flex">
            <TransitionGroup
              name="breadcrumb-transition"
              tag="ol"
              class="m-0 flex list-none items-center gap-1.5 p-0 text-[13px]"
            >
              <li
                v-for="(crumb, idx) in breadcrumbs"
                :key="`${route.path}-${crumb.title}-${idx}`"
                class="inline-flex items-center gap-1.5"
              >
                <span
                  v-if="idx < breadcrumbs.length - 1"
                  class="inline-flex items-center gap-1 text-[#71717a] transition-colors"
                  :class="crumb.path ? 'cursor-pointer hover:text-[#18181b]' : ''"
                  @click="crumb.path && router.push(crumb.path)"
                >
                  <MenuIcon v-if="crumb.icon" :name="crumb.icon" class="!text-[14px]" />
                  <span>{{ crumb.title }}</span>
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1 font-medium text-[#18181b]"
                >
                  <MenuIcon v-if="crumb.icon" :name="crumb.icon" class="!text-[14px] text-[#3f3f46]" />
                  <span>{{ crumb.title }}</span>
                </span>
                <ChevronRight
                  v-if="idx < breadcrumbs.length - 1"
                  class="h-3.5 w-3.5 text-[#a1a1aa]"
                  :stroke-width="1.75"
                />
              </li>
            </TransitionGroup>
          </nav>
        </div>

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[#3f3f46] transition hover:bg-[#f4f4f5] hover:text-[#18181b] active:scale-95"
            :class="{ '!bg-[#e6f0fc] !text-[#006be6]': isFullscreen }"
            :title="isFullscreen ? '退出全屏' : '全屏切换'"
            @click="toggleFullscreen"
          >
            <Minimize v-if="isFullscreen" class="h-4 w-4" :stroke-width="1.75" />
            <Maximize v-else class="h-4 w-4" :stroke-width="1.75" />
          </button>

          <!-- 1:1 复刻原版 Vben 5 UserDropdown：绿点圆形头像 + 248px 个人信息头部卡 + 快捷键提示 -->
          <el-dropdown trigger="click" popper-class="bf-user-dropdown-popper" @command="handleUserCommand">
            <div
              class="ml-1 mr-1.5 flex cursor-pointer items-center justify-center rounded-full p-1 transition hover:bg-[#f4f4f5]"
              :title="displayName"
            >
              <div class="relative inline-flex">
                <el-avatar
                  :size="30"
                  :src="userStore.userInfo?.avatar || undefined"
                  class="!bg-[#006be6] text-xs font-semibold text-white"
                >
                  {{ displayName.slice(0, 1).toUpperCase() }}
                </el-avatar>
                <span
                  class="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500"
                />
              </div>
            </div>
            <template #dropdown>
              <div class="w-[248px] pb-1">
                <div class="flex items-center gap-3 border-b border-[#f1f2f5] px-3.5 py-3">
                  <div class="relative shrink-0">
                    <el-avatar
                      :size="44"
                      :src="userStore.userInfo?.avatar || undefined"
                      class="!bg-[#006be6] text-base font-semibold text-white"
                    >
                      {{ displayName.slice(0, 1).toUpperCase() }}
                    </el-avatar>
                    <span
                      class="absolute right-0 bottom-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500"
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate text-sm font-medium text-[#18181b]">
                        {{ displayName }}
                      </span>
                      <span
                        class="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600"
                      >
                        {{ roleBadgeText }}
                      </span>
                    </div>
                    <div class="mt-0.5 truncate text-xs text-[#71717a]">
                      {{ displaySubtitle }}
                    </div>
                  </div>
                </div>

                <el-dropdown-menu class="!border-none !p-1 !shadow-none">
                  <el-dropdown-item command="profile" class="!rounded-md !py-2">
                    <div class="flex w-full items-center justify-between">
                      <span class="inline-flex items-center gap-2">
                        <UserRound class="h-4 w-4 text-[#52525b]" :stroke-width="1.75" />
                        <span>个人中心</span>
                      </span>
                    </div>
                  </el-dropdown-item>
                  <el-dropdown-item command="lock" divided class="!rounded-md !py-2">
                    <div class="flex w-full items-center justify-between gap-6">
                      <span class="inline-flex items-center gap-2">
                        <LockKeyhole class="h-4 w-4 text-[#52525b]" :stroke-width="1.75" />
                        <span>锁定屏幕</span>
                      </span>
                      <span class="text-[11px] tracking-wider text-[#a1a1aa]">
                        {{ altLabel }} L
                      </span>
                    </div>
                  </el-dropdown-item>
                  <el-dropdown-item command="logout" divided class="!rounded-md !py-2">
                    <div class="flex w-full items-center justify-between gap-6">
                      <span class="inline-flex items-center gap-2">
                        <LogOut class="h-4 w-4 text-[#52525b]" :stroke-width="1.75" />
                        <span>退出登录</span>
                      </span>
                      <span class="text-[11px] tracking-wider text-[#a1a1aa]">
                        {{ altLabel }} Q
                      </span>
                    </div>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </div>
            </template>
          </el-dropdown>
        </div>
      </header>

      <!-- Chrome 曲线风格多标签页栏 (38px) -->
      <TabsChrome
        :tabs="tabsStore.tabs"
        :active-path="route.path"
        :content-maximized="contentMaximized"
        :refreshing="tabsStore.refreshing"
        @select="(p) => router.push(p)"
        @close="handleCloseTab"
        @toggle-pin="(p) => tabsStore.togglePinTab(p)"
        @reorder="(from, to) => tabsStore.reorderTabs(from, to)"
        @close-left="handleCloseLeft"
        @close-right="handleCloseRight"
        @close-other="handleCloseOther"
        @close-all="handleCloseAll"
        @refresh="tabsStore.triggerRefresh()"
        @toggle-maximize="contentMaximized = !contentMaximized"
      />

      <!-- 浅灰底主内容区（支持列表页 h-full 一屏锁定内部滚动，与长页平滑滚动兼容） -->
      <main class="bf-layout-main relative min-h-0 flex-1 overflow-auto bg-[var(--bf-bg-deep)] p-4">
        <!-- Vben 5 刷新/切换过渡四点加载层 -->
        <transition name="fade">
          <div
            v-if="tabsStore.refreshing"
            class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-white/55 backdrop-blur-[1px]"
          >
            <div class="bf-vben-spinner" aria-label="页面加载中">
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
        </transition>

        <!-- 清理会话后，业务页停止挂载，避免导航期间以匿名状态发起请求。 -->
        <router-view v-if="sessionId" v-slot="{ Component }">
          <transition name="bf-fade-slide" appear mode="out-in">
            <keep-alive :key="sessionId ?? undefined" :include="tabsStore.cachedNames">
              <component :is="Component" :key="`${route.path}-${tabsStore.refreshKey}`" />
            </keep-alive>
          </transition>
        </router-view>

        <el-backtop target=".bf-layout-main" :right="28" :bottom="28" />
      </main>
    </div>

    <!-- 锁屏密码设置弹窗 -->
    <FormDialog
      v-model="lockModalVisible"
      title="锁定屏幕"
      width="420px"
      confirm-text="锁定"
      :show-fullscreen="false"
      @confirm="submitLockScreen"
    >
      <div class="flex flex-col items-center py-2">
        <el-avatar
          :size="64"
          :src="userStore.userInfo?.avatar || undefined"
          class="mb-3 !bg-[#006be6] text-xl font-semibold text-white"
        >
          {{ displayName.slice(0, 1).toUpperCase() }}
        </el-avatar>
        <div class="mb-4 text-sm font-medium text-[#18181b]">{{ displayName }}</div>
        <el-input
          v-model="lockPasswordInput"
          type="password"
          show-password
          size="large"
          placeholder="请输入本次锁屏密码"
          @keyup.enter="submitLockScreen"
        />
      </div>
    </FormDialog>

    <!-- 全屏模糊锁屏遮罩 -->
    <transition name="slide-up">
      <LockScreen
        v-if="appStore.isLockScreen"
        :avatar="userStore.userInfo?.avatar || undefined"
        :username="displayName"
        @unlock="handleUnlock"
        @logout="handleLockLogout"
      />
    </transition>
  </div>
</template>

<style scoped>
.bf-sidebar-scroll-wrap::before,
.bf-sidebar-scroll-wrap::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 10px;
  pointer-events: none;
  z-index: 2;
}

.bf-sidebar-scroll-wrap::before {
  top: 0;
  background: linear-gradient(to bottom, rgb(255 255 255 / 95%), rgb(255 255 255 / 0%));
}

.bf-sidebar-scroll-wrap::after {
  bottom: 0;
  background: linear-gradient(to top, rgb(255 255 255 / 95%), rgb(255 255 255 / 0%));
}
</style>

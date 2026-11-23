/**
 * 路由定义与动态菜单加载守卫：
 * 1. 静态路由提供登录、找回密码、概览、个人中心与错误页；
 * 2. 登录后按后端 `/system/auth/get-permission-info` 返回的菜单树动态注册业务路由；
 * 3. 支持首次登录强制改密拦截与 NProgress 进度提示。
 */
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';
import type { Pinia } from 'pinia';
import { watch } from 'vue';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';

import type { MenuRouteItem } from '@/api/auth';
import { getAppConfig } from '@/config/app';
import { useDictStore } from '@/stores/dict';
import { useTabsStore } from '@/stores/tabs';
import { useUserStore } from '@/stores/user';
import { getAccessToken, getSessionId, isSessionFromStorage, loginPlatform, loginPlatformQuery, sessionId } from '@/utils/token';

NProgress.configure({ showSpinner: false });

const viewModules = import.meta.glob('../views/**/*.vue');
const PUBLIC_PATHS = new Set(['/login', '/forget-password', '/403', '/404']);
const dynamicRouteNames: string[] = [];

const staticRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { title: '登录', hideTab: true },
  },
  {
    path: '/forget-password',
    name: 'ForgetPassword',
    component: () => import('@/views/auth/ForgetPasswordView.vue'),
    meta: { title: '重置密码', hideTab: true },
  },
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/views/error/ForbiddenView.vue'),
    meta: { title: '无访问权限', hideTab: true },
  },
  {
    path: '/404',
    name: 'NotFound',
    component: () => import('@/views/error/NotFoundView.vue'),
    meta: { title: '页面不存在', hideTab: true },
  },
  {
    path: '/',
    name: 'RootLayout',
    component: () => import('@/layout/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'DashboardView',
        component: () => import('@/views/dashboard/DashboardView.vue'),
        meta: { title: '概览', affix: true, icon: 'ep:odometer' },
      },
      {
        path: 'profile',
        name: 'ProfileView',
        component: () => import('@/views/profile/ProfileView.vue'),
        meta: { title: '个人中心', keepAlive: false },
      },
      {
        path: 'profile/change-password',
        name: 'ChangePasswordView',
        component: () => import('@/views/profile/ChangePasswordView.vue'),
        meta: { title: '修改密码', keepAlive: false, hideTab: true },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: staticRoutes,
});

function resolveFullPath(parentPath: string, currentPath: string): string {
  if (!currentPath) return parentPath || '/';
  if (currentPath.startsWith('/')) return currentPath;
  const normalizedParent = parentPath.replace(/\/$/, '');
  return `${normalizedParent}/${currentPath}`.replace(/\/+/g, '/');
}

function resolveViewComponent(componentPath?: string) {
  if (!componentPath) return undefined;
  const cleaned = componentPath.replace(/^\/+/, '').replace(/\.vue$/, '');
  const exactKey = `../views/${cleaned}.vue`;
  if (viewModules[exactKey]) {
    return viewModules[exactKey];
  }
  const indexKey = `../views/${cleaned}/index.vue`;
  if (viewModules[indexKey]) {
    return viewModules[indexKey];
  }
  return undefined;
}

export function clearDynamicRoutes(): void {
  for (const name of dynamicRouteNames.splice(0)) {
    if (router.hasRoute(name)) {
      router.removeRoute(name);
    }
  }
}

export function syncSessionRoutes(pinia: Pinia): void {
  const tabs = useTabsStore(pinia);
  const dict = useDictStore(pinia);
  watch([sessionId, loginPlatform], ([next], [previous, previousPlatform]) => {
    if (next === previous) return;
    // Capture before resets: a local fresh login is left to LoginView; storage-driven ones redirect.
    const fromStorage = isSessionFromStorage();
    clearDynamicRoutes();
    tabs.reset();
    dict.reset();
    if (!previous && !fromStorage) return;
    queueMicrotask(() => {
      if (getSessionId() !== next) return;
      const to = next ? '/dashboard' : '/login';
      if (next || router.currentRoute.value.path !== to) {
        const query = next ? {} : loginPlatformQuery(previousPlatform);
        void router.replace({ path: to, query, force: true });
      }
    });
  }, { flush: 'sync' });
}

export function registerMenuRoutes(menus: MenuRouteItem[]): void {
  clearDynamicRoutes();
  const walk = (nodes: MenuRouteItem[], parentPath: string) => {
    for (const node of nodes) {
      const fullPath = resolveFullPath(parentPath, node.path || '');
      const viewLoader = resolveViewComponent(node.component);
      if (viewLoader) {
        const routeName = node.componentName || `Menu_${node.id}`;
        const relativePath = fullPath.replace(/^\/+/, '');
        router.addRoute('RootLayout', {
          path: relativePath,
          name: routeName,
          component: viewLoader,
          meta: {
            title: node.name,
            icon: node.icon,
            keepAlive: node.keepAlive !== false,
          },
        });
        dynamicRouteNames.push(routeName);
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children, fullPath);
      }
    }
  };
  walk(menus, '');

  // 动态菜单挂载完毕后再补齐兜底 404，避免刷新动态路由直接落入 404
  if (!router.hasRoute('CatchAll404')) {
    router.addRoute({
      path: '/:pathMatch(.*)*',
      name: 'CatchAll404',
      redirect: '/404',
    });
    dynamicRouteNames.push('CatchAll404');
  }
}

router.beforeEach(async (to, from) => {
  NProgress.start();
  const { appTitle } = getAppConfig();
  document.title = to.meta?.title ? `${String(to.meta.title)} - ${appTitle}` : appTitle;

  const owner = getSessionId();
  const userStore = useUserStore();
  const dictStore = useDictStore();

  if (!getAccessToken()) {
    if (PUBLIC_PATHS.has(to.path)) {
      return true;
    }
    return {
      path: '/login',
      query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : undefined,
    };
  }

  if (to.path === '/login') {
    return '/dashboard';
  }

  if (
    userStore.passwordChangeRequired &&
    to.path !== '/profile/change-password'
  ) {
    return '/profile/change-password';
  }

  if (!userStore.routesLoaded) {
    try {
      const info = await userStore.fetchPermissionInfo();
      if (getSessionId() !== owner) return false;
      registerMenuRoutes(info.menus ?? []);
      userStore.markRoutesLoaded(true);
      void dictStore.ensureLoaded().catch(() => {
        // Request errors have already been handled by the transport.
      });
      return { path: to.path, query: to.query, hash: to.hash, replace: true };
    } catch {
      // An explicitly invalid or replaced login was already cleared by the transport or another tab.
      if (getSessionId() !== owner) return false;
      // Transient transport/bootstrap failure: keep the login; the next navigation retries.
      if (from.matched.length) return false;
      if (to.path === '/dashboard' || to.path === '/profile/change-password') return true;
      return '/dashboard';
    }
  }

  return true;
});

router.afterEach(() => {
  NProgress.done();
});

/** 登录成功后的默认跳转测试：未传成功回调时必须导航到应用偏好配置的默认首页。 */
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { preferences } from '@vben/preferences';
import { initStores, useAccessStore } from '@vben/stores';

import { disposePinia, getActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthPermissionInfoApi, loginApi } from '#/api';
import { resetRoutes } from '#/router';
import { advanceSession } from '#/utils/auth-session';

import { useAuthStore } from './auth';

vi.mock(
  '#/api',
  /** 只替换外部 HTTP 边界，保留真实认证 Store。 */ () => ({
    getAuthPermissionInfoApi: vi.fn(),
    loginApi: vi.fn(),
    logoutApi: vi.fn(),
    register: vi.fn(),
    smsLogin: vi.fn(),
  }),
);
vi.mock(
  '#/api/system/user/profile',
  /** 本组不涉及改密，保留可替换入口。 */ () => ({
    updateUserPassword: vi.fn(),
  }),
);
vi.mock(
  '#/router',
  /** 本组不使用动态路由，只保留真实 Store 需要的清理入口。 */ () => ({
    resetRoutes: vi.fn(),
  }),
);
vi.mock(
  '#/locales',
  /** 消除语言加载副作用，仅保留稳定消息键。 */ () => ({
    /** 保留消息标识供通知边界使用。 */ $t: (key: string) => key,
  }),
);
vi.mock(
  'element-plus',
  /** 不挂载通知 UI，只观察登录成功通知。 */ () => ({
    ElNotification: { success: vi.fn() },
  }),
);

describe('登录成功后的默认跳转', /** 没有显式成功回调时，登录必须回到偏好配置的默认首页。 */ () => {
  let namespace: string;
  let router: ReturnType<typeof createRouter>;
  let homePath: string;
  let auth: ReturnType<typeof useAuthStore>;

  beforeEach(
    /** 为每例建立独立 Router、身份与真实默认首页。 */ async () => {
      vi.clearAllMocks();
      vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
        VITE_APP_STORE_SECURE_KEY: crypto.randomUUID(),
      });
      advanceSession();
      router = createRouter({
        history: createMemoryHistory(),
        routes: [{ name: 'Login', path: '/auth/login', component: {} }],
      });
      const app = createApp({});
      app.use(router);
      // 真实路由初始化完成后，登录跳转的断言才读取到本次导航结果。
      await router.isReady();
      namespace = `auth-router-tests-${crypto.randomUUID()}`;
      await initStores(app, { namespace });
      auth = app.runWithContext(
        /** 在真实 Router 注入上下文内创建认证 Store。 */ () => useAuthStore(),
      );
      // 默认首页由应用初始化决定，用例跟随真实取值，不把偏好改写成测试专属常量。
      homePath = preferences.app.defaultHomePath;
      router.addRoute({ name: 'Home', path: homePath, component: {} });
      vi.mocked(loginApi).mockResolvedValue({
        accessToken: 'DUMMY-test-access',
        expiresTime: 1,
        refreshToken: 'DUMMY-test-refresh',
        userId: 7,
      });
      vi.mocked(getAuthPermissionInfoApi).mockResolvedValue({
        menus: [],
        permissions: ['system:user:list'],
        roles: ['admin'],
        user: {
          avatar: '',
          homePath,
          nickname: 'User 7',
          userId: '7',
          username: 'user-7',
        },
      });
    },
  );

  afterEach(
    /** 回收本例 Router、Store 与持久化数据并恢复全局配置。 */ () => {
      router.options.history.destroy();
      const pinia = getActivePinia();
      if (pinia) disposePinia(pinia);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(namespace)) localStorage.removeItem(key);
      }
      vi.unstubAllGlobals();
    },
  );

  it('未传成功回调时导航到偏好默认首页', /** 登录成功必须离开登录页，落到应用约定的首页。 */ async () => {
    await auth.authLogin('username', {
      password: 'DUMMY-test-input',
      username: 'admin',
    });

    expect(router.currentRoute.value.path).toBe(homePath);
  });

  it('默认跳转同时写入登录凭据并清理动态路由', /** 导航与身份写入必须同时完成，不能只跳转不登录。 */ async () => {
    await auth.authLogin('username', {
      password: 'DUMMY-test-input',
      username: 'admin',
    });

    expect(useAccessStore().accessToken).toBe('DUMMY-test-access');
    expect(resetRoutes).toHaveBeenCalled();
  });
});

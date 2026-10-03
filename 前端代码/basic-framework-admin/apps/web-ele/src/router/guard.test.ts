/** 使用真实导航和权限安装验证守卫不能让旧身份路由、菜单及字典迟到写入。 */
import type { RouteRecordRaw } from 'vue-router';

import { createMemoryHistory, createRouter } from 'vue-router';

import { generateAccessible, resetAccessibleRoutes } from '@vben/access';
import { useAccessStore, useDictStore, useUserStore } from '@vben/stores';

import {
  createPinia,
  disposePinia,
  getActivePinia,
  setActivePinia,
} from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSimpleDictDataList } from '#/api/core/dict';
import { advanceSession } from '#/utils/auth-session';

import { generateAccess } from './access';
import { createRouterGuard } from './guard';

vi.mock(
  '#/api/core/dict',
  /** 控制字典传输完成时间，保留实际 Store 写入校验。 */ () => ({
    getSimpleDictDataList: vi.fn(),
  }),
);
vi.mock(
  '#/router/routes',
  /** 只声明本例的公开入口，业务路由必须经权限守卫安装。 */ () => ({
    accessRoutes: [],
    coreRouteNames: ['Root', 'Login'],
  }),
);
vi.mock(
  '#/store',
  /** 权限已通过真实用户 Store 提供，此场景不应重新请求身份。 */ () => ({
    /** 提供不会触发外部请求的认证接口。 */ useAuthStore: () => ({
      fetchUserInfo: vi.fn(),
    }),
  }),
);
vi.mock(
  './access',
  /** 控制菜单生成时机，安装仍使用真实共享路由实现。 */ () => ({
    generateAccess: vi.fn(),
  }),
);
vi.mock(
  '@vben/preferences',
  /** 关闭进度动画，使测试只观察路由与状态生命周期。 */ () => ({
    preferences: {
      app: { defaultHomePath: '/home' },
      transition: { progress: false },
    },
  }),
);
vi.mock(
  '#/utils/feedback',
  /** 隔离展示层，取消不会依赖通知组件。 */ () => ({
    /** 返回可关闭的加载提示。 */ showLoadingMessage: () => ({
      close: vi.fn(),
    }),
  }),
);

/** 创建兼容支持工具链的手动完成结果。 */
function deferred<T>() {
  let resolve!: /** 释放本例响应。 */ (value: PromiseLike<T> | T) => void;
  const promise = new Promise<T>(
    /** 保存当前用例独占的完成句柄。 */ (accept) => {
      resolve = accept;
    },
  );
  return { promise, resolve };
}

describe('导航守卫身份竞争', /** 验证安装前和状态写入前的身份检查均生效。 */ () => {
  let router: ReturnType<typeof createRouter>;

  beforeEach(
    /** 每例创建独立 Router、Pinia 及已登录身份。 */ async () => {
      vi.clearAllMocks();
      advanceSession();
      setActivePinia(createPinia());
      router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { name: 'Root', path: '/', component: {} },
          { name: 'Login', path: '/auth/login', component: {} },
          { name: 'Fallback', path: '/:pathMatch(.*)*', component: {} },
        ],
      });
      createRouterGuard(router);
      useAccessStore().setAccessToken('test-session-A');
      useUserStore().setUserInfo({
        userId: 'A',
        nickname: 'A',
        username: 'A',
        avatar: '',
      });
      await router.push('/');
    },
  );

  afterEach(
    /** 回收本例路由与 Store，不把动态记录留给其他用例。 */ () => {
      resetAccessibleRoutes(router);
      router.options.history.destroy();
      const pinia = getActivePinia();
      if (pinia) disposePinia(pinia);
    },
  );

  it('a 导航生成晚到不得覆盖 B 的导航、菜单和字典', /** 在 A 的菜单生成等待期间完成 B 登录导航，再释放 A。 */ async () => {
    const started = deferred<undefined>();
    const oldMenus = deferred<RouteRecordRaw[]>();
    const oldDict =
      deferred<Awaited<ReturnType<typeof getSimpleDictDataList>>>();
    vi.mocked(getSimpleDictDataList)
      .mockReturnValueOnce(oldDict.promise)
      .mockResolvedValueOnce([
        {
          dictType: 'identity',
          label: 'B',
          value: 'B',
          colorType: '',
          cssClass: '',
        },
      ]);
    vi.mocked(generateAccess)
      .mockImplementationOnce(
        /** 真实安装前暂停旧身份菜单结果。 */ async (options) => {
          started.resolve(undefined);
          const routes = await oldMenus.promise;
          return generateAccessible('frontend', { ...options, routes });
        },
      )
      .mockImplementationOnce(
        /** 新身份使用真实安装逻辑完成导航。 */ (options) =>
          generateAccessible('frontend', {
            ...options,
            routes: [
              { name: 'B', path: '/b', component: {}, meta: { title: 'B' } },
            ],
          }),
      );
    const oldNavigation = router.push('/a');
    await started.promise;
    advanceSession();
    useAccessStore().$reset();
    useDictStore().$reset();
    useAccessStore().setAccessToken('test-session-B');
    await router.push('/b');
    oldMenus.resolve([
      { name: 'A', path: '/a', component: {}, meta: { title: 'A' } },
    ]);
    oldDict.resolve([
      {
        dictType: 'identity',
        label: 'A',
        value: 'A',
        colorType: '',
        cssClass: '',
      },
    ]);
    await oldNavigation;
    expect(router.currentRoute.value.path).toBe('/b');
    expect(router.hasRoute('A')).toBe(false);
    expect(router.hasRoute('B')).toBe(true);
    expect(
      useAccessStore().accessMenus.map(
        /** 读取最终可见菜单路径，不依赖内部安装报告。 */ (menu) => menu.path,
      ),
    ).toEqual(['/b']);
    expect(useDictStore().getDictOptions('identity')).toEqual([
      { label: 'B', value: 'B', colorType: '', cssClass: '' },
    ]);
  });

  it.each([
    '%',
    'https://example.test',
    '//example.test',
    '/auth/login',
    ['/a', '/b'],
  ])(
    '非法回跳 %s 回到首页且不会抛解码异常',
    /** 实际 Vue Router 会把重复查询参数解析为数组。 */ async (redirect) => {
      useAccessStore().setIsAccessChecked(true);
      await router.push({ path: '/auth/login', query: { redirect } });
      expect(router.currentRoute.value.path).toBe('/home');
    },
  );

  it('合法站内回跳保留查询及片段', /** 使用生产的编码方式验证一次解码后的路由目标。 */ async () => {
    useAccessStore().setIsAccessChecked(true);
    await router.push({
      path: '/auth/login',
      query: { redirect: encodeURIComponent('/target?tab=items#anchor') },
    });
    expect(router.currentRoute.value.fullPath).toBe('/target?tab=items#anchor');
  });
});

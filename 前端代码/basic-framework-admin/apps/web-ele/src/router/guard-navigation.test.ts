/**
 * 路由守卫导航契约回归（补齐 createRouterGuard 的导航分支）。
 *
 * 覆盖四组职责：
 * ① 页面加载进度按“是否首次加载”成对启动与停止；
 * ② 无令牌时的放行、登录页重定向与回跳参数组装；
 * ③ 字典预取失败只做可诊断提示，不打断导航；
 * ④ 用户信息缺失时的真实权限请求、会话失效取消与错误上抛。
 * 权限安装依赖远端接口，用例只替换该外部边界（路由表、权限请求、字典接口、提示通道）；
 * 导航、Pinia Store、会话代次与守卫本身均使用真实实现。
 */
import type { RouteRecordRaw } from 'vue-router';

import { createMemoryHistory, createRouter } from 'vue-router';

import { resetAccessibleRoutes } from '@vben/access';
import { LOGIN_PATH } from '@vben/constants';
import { useAccessStore, useUserStore } from '@vben/stores';

import {
  createPinia,
  disposePinia,
  getActivePinia,
  setActivePinia,
} from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceSession } from '#/utils/auth-session';

import { createRouterGuard } from './guard';

const spies = vi.hoisted(
  /** 只替换外部边界：进度提示、字典接口、权限安装、身份请求与提示通道。 */ () => ({
    close: vi.fn(),
    fetchUserInfo: vi.fn(),
    generateAccess: vi.fn(),
    getSimpleDictDataList: vi.fn(),
    logWarn: vi.fn(),
    startProgress: vi.fn(),
    stopProgress: vi.fn(),
  }),
);

vi.mock(
  '@vben/utils',
  /** 保留其他工具实现，只把进度提示与告警换成可观察替身。 */ async (
    importOriginal,
  ) => {
    const original = await importOriginal<Record<string, unknown>>();
    return {
      ...original,
      logWarn: spies.logWarn,
      startProgress: spies.startProgress,
      stopProgress: spies.stopProgress,
    };
  },
);

vi.mock(
  '#/api/core/dict',
  /** 字典接口是外部边界，由用例决定成功或失败。 */ () => ({
    getSimpleDictDataList: spies.getSimpleDictDataList,
  }),
);

vi.mock(
  '#/router/routes',
  /** 只声明本组需要的基本路由名，业务路由必须经权限守卫安装。 */ () => ({
    accessRoutes: [],
    coreRouteNames: ['Root', 'Login'],
  }),
);

vi.mock(
  '#/store',
  /** 身份与权限统一由真实用户 Store 提供，这里只替换远端请求。 */ () => ({
    /** 返回可观察的认证 Store 替身，不发起真实请求。 */
    useAuthStore: () => ({ fetchUserInfo: spies.fetchUserInfo }),
  }),
);

vi.mock(
  './access',
  /** 菜单与路由安装的远端结果由用例控制，安装动作仍需真实执行。 */ () => ({
    generateAccess: spies.generateAccess,
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 隔离展示层，只保留“提示已关闭”这一可观察副作用。 */ () => ({
    /** 返回带可观察关闭入口的加载提示。 */
    showLoadingMessage: () => ({ close: spies.close }),
  }),
);

vi.mock(
  '@vben/preferences',
  /** 打开进度提示并把默认首页固定为 /home，使守卫分支可确定复现。 */ () => ({
    preferences: {
      app: { defaultHomePath: '/home' },
      transition: { progress: true },
    },
  }),
);

/** 初始路由表：与生产一致，登录页是核心路由，无令牌访问它时直接放行。 */
const ROUTES: RouteRecordRaw[] = [
  { component: {}, name: 'Root', path: '/' },
  { component: {}, name: 'Home', path: '/home' },
  { component: {}, name: 'Target', path: '/target' },
  {
    component: {},
    meta: { ignoreAccess: true, title: '忽略权限页面' },
    name: 'Ignored',
    path: '/ignored',
  },
  { component: {}, name: 'Login', path: LOGIN_PATH },
  { component: {}, name: 'Fallback', path: '/:pathMatch(.*)*' },
];

/** 用例创建的真实路由器。 */
let router: ReturnType<typeof createRouter>;

describe('createRouterGuard 导航契约', /** 进度、放行、重定向、诊断与身份加载五类行为。 */ () => {
  beforeEach(
    /** 每例创建独立 Router、Pinia 与会话代次，并登记默认的安装结果。 */ async () => {
      vi.clearAllMocks();
      advanceSession();
      setActivePinia(createPinia());
      router = createRouter({ history: createMemoryHistory(), routes: ROUTES });
      createRouterGuard(router);
      spies.getSimpleDictDataList.mockResolvedValue([]);
      spies.generateAccess.mockResolvedValue({
        accessibleMenus: [],
        accessibleRoutes: [],
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

  it('首次加载启动进度、加载完成后停止且重复访问不再启动', /** 进度提示必须与真实加载状态一致，重复访问同一页面不能再启动一次。 */ async () => {
    useAccessStore().setAccessToken('DUMMY-token');
    useAccessStore().setIsAccessChecked(true);

    // 基线包含 beforeEach 进入根路由的一次真实导航，断言只比较本次增量。
    /** 读取已启动进度的次数。 */
    const started = () => {
      return spies.startProgress.mock.calls.length;
    };
    /** 读取已停止进度的次数。 */
    const stopped = () => {
      return spies.stopProgress.mock.calls.length;
    };
    const baseStart = started();
    const baseStop = stopped();

    await router.push('/home');
    expect(started() - baseStart).toBe(1);
    expect(stopped() - baseStop).toBe(1);

    await router.push('/target');
    expect(started() - baseStart).toBe(2);
    expect(stopped() - baseStop).toBe(2);

    // 回到已加载过的页面：不再启动进度，但仍要停止上一次。
    await router.push('/home');
    expect(router.currentRoute.value.meta.loaded).toBe(true);
    expect(started() - baseStart).toBe(2);
    expect(stopped() - baseStop).toBe(3);
  });

  it('无令牌且声明忽略权限时直接放行', /** ignoreAccess 是公开的免登录声明，必须能真正访问该页面。 */ async () => {
    await router.push('/ignored');

    expect(router.currentRoute.value.path).toBe('/ignored');
    expect(spies.generateAccess).not.toHaveBeenCalled();
  });

  it('无令牌访问默认首页时重定向登录页且不携带回跳参数', /** 默认首页就是登录后的落点，无需回跳参数，也避免地址栏出现冗余查询。 */ async () => {
    await router.push('/home');

    expect(router.currentRoute.value.path).toBe(LOGIN_PATH);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it('无令牌访问其他页面时携带编码后的回跳地址', /** 回跳地址必须编码后放入查询参数，登录后才能安全还原目标页面。 */ async () => {
    await router.push('/target');

    expect(router.currentRoute.value.path).toBe(LOGIN_PATH);
    expect(router.currentRoute.value.query.redirect).toBe(
      encodeURIComponent('/target'),
    );
  });

  it('字典预取失败只提示不打断导航', /** 字典属于可降级数据，失败要有可诊断记录，不能阻止用户进入页面。 */ async () => {
    useAccessStore().setAccessToken('DUMMY-token');
    useUserStore().setUserInfo({
      avatar: '',
      nickname: 'tester',
      userId: 'U1',
      username: 'tester',
    });
    spies.getSimpleDictDataList.mockRejectedValue(new Error('字典不可用'));
    spies.generateAccess.mockResolvedValue({
      accessibleMenus: [{ path: '/home' } as never],
      accessibleRoutes: [],
    });

    await router.push('/home');
    await vi.waitFor(
      /** 等待字典失败的拒绝处理落地，再核对诊断记录。 */ () => {
        expect(spies.logWarn).toHaveBeenCalledWith('字典加载失败');
      },
    );

    // 导航本身仍然完成，并安装了远端返回的菜单。
    expect(router.currentRoute.value.path).toBe('/home');
    expect(useAccessStore().accessMenus).toEqual([{ path: '/home' }]);
    expect(useAccessStore().isAccessChecked).toBe(true);
  });

  it('用户信息缺失时请求身份并按角色安装菜单与路由', /** 未加载过身份的导航必须先取回身份，再把该身份的角色交给菜单与路由安装。 */ async () => {
    useAccessStore().setAccessToken('DUMMY-token');
    spies.fetchUserInfo.mockImplementation(
      /** 按真实认证 Store 的口径写入身份与角色，再返回身份信息。 */ async () => {
        const userStore = useUserStore();
        userStore.setUserInfo({
          avatar: '',
          nickname: 'U2',
          userId: 'U2',
          username: 'U2',
        });
        userStore.setUserRoles(['admin']);
        return {
          user: {
            avatar: '',
            nickname: 'U2',
            userId: 'U2',
            username: 'U2',
          },
        };
      },
    );
    spies.generateAccess.mockResolvedValue({
      accessibleMenus: [{ path: '/home' } as never],
      accessibleRoutes: [],
    });

    await router.push('/home');

    expect(spies.fetchUserInfo).toHaveBeenCalledTimes(1);
    // 身份请求必须带上导航开始时捕获的会话代次，权限结果才能判断归属。
    expect(typeof spies.fetchUserInfo.mock.calls[0]?.[0]).toBe('number');
    // 身份请求无论成败都要关闭加载提示。
    expect(spies.close).toHaveBeenCalledTimes(1);

    const [options] = spies.generateAccess.mock.calls.at(-1) ?? [];
    expect(options?.roles).toEqual(['admin']);
    expect(options?.routes).toEqual([]);
    // 安装动作必须带上生命周期判定，供远端结果写回前复核身份。
    expect(options?.isCurrent?.()).toBe(true);
    expect(useAccessStore().isAccessChecked).toBe(true);
    expect(router.currentRoute.value.path).toBe('/home');
  });

  it('身份请求期间会话被替换时取消导航且不改写状态', /** 旧会话的身份结果不得安装菜单或改写访问状态，导航必须被取消。 */ async () => {
    useAccessStore().setAccessToken('DUMMY-token');
    spies.fetchUserInfo.mockImplementation(
      /** 模拟请求期间发生新的登录，使本次身份请求过期。 */ async () => {
        advanceSession();
        throw new Error('权限请求已过期');
      },
    );

    const failure = await router.push('/home');

    expect(failure).toBeTruthy();
    expect(router.currentRoute.value.path).toBe('/');
    expect(useAccessStore().isAccessChecked).toBe(false);
    expect(spies.generateAccess).not.toHaveBeenCalled();
    // 过期导航的失败不向用户提示，但仍要关闭加载提示。
    expect(spies.close).toHaveBeenCalledTimes(1);
  });

  it('身份请求在当前会话内失败时保留原始错误', /** 当前身份的真实失败必须上抛，不能伪装成导航成功或静默取消。 */ async () => {
    useAccessStore().setAccessToken('DUMMY-token');
    spies.fetchUserInfo.mockRejectedValue(new Error('权限接口不可用'));

    await expect(router.push('/home')).rejects.toThrow('权限接口不可用');

    expect(spies.close).toHaveBeenCalledTimes(1);
    expect(useAccessStore().isAccessChecked).toBe(false);
  });
});

/** 使用真实 Store 和 Router 验证登录、退出及改密之间的迟到响应隔离。 */
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { resetAccessibleRoutes } from '@vben/access';
import { initStores, useAccessStore, useUserStore } from '@vben/stores';
import { resetStaticRoutes } from '@vben/utils';

import { disposePinia, getActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAuthPermissionInfoApi,
  loginApi,
  logoutApi,
  register,
  smsLogin,
} from '#/api';
import { updateUserPassword } from '#/api/system/user/profile';
import { resetRoutes } from '#/router';
import { advanceSession } from '#/utils/auth-session';

import { useAuthStore } from './auth';

vi.mock(
  '#/api',
  /** 仅替换外部 HTTP 边界，保留真实认证 Store。 */ () => ({
    getAuthPermissionInfoApi: vi.fn(),
    loginApi: vi.fn(),
    logoutApi: vi.fn(),
    register: vi.fn(),
    smsLogin: vi.fn(),
  }),
);
vi.mock(
  '#/api/system/user/profile',
  /** 控制改密响应相对于身份切换的顺序。 */ () => ({
    updateUserPassword: vi.fn(),
  }),
);
vi.mock(
  '#/router',
  /** 每例将路由清理连接到自己的真实 Router。 */ () => ({
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
  /** 不挂载通知 UI，身份行为仍经真实 Store 验证。 */ () => ({
    ElNotification: { success: vi.fn() },
  }),
);

/** 创建测试可显式释放的异步响应，避免固定等待推测竞争顺序。 */
function deferred<T>() {
  let resolve!: /** 成功释放本例等待的异步结果。 */ (
    value: PromiseLike<T> | T,
  ) => void;
  let reject!: /** 将受控错误传播给本例等待者。 */ (reason?: unknown) => void;
  const promise = new Promise<T>(
    /** 保存仅由本例持有的完成控制器。 */ (accept, fail) => {
      resolve = accept;
      reject = fail;
    },
  );
  return { promise, reject, resolve };
}

/** 登录测试关注身份写入，不额外导航业务首页。 */
async function keepCurrentPage(): Promise<undefined> {
  return undefined;
}

/** 使用标识区分测试身份；不包含可连接任何环境的真实凭据。 */
function loginResult(userId: number) {
  return {
    userId,
    accessToken: `test-session-${userId}`,
    refreshToken: `test-refresh-${userId}`,
    expiresTime: 1,
  };
}

/** 构造权限接口的最小身份结果，验证写入归属。 */
function permission(
  userId: number,
): Awaited<ReturnType<typeof getAuthPermissionInfoApi>> {
  return {
    user: {
      userId: String(userId),
      avatar: '',
      homePath: '/',
      username: `user-${userId}`,
      nickname: `User ${userId}`,
    },
    menus: [
      {
        id: userId,
        parentId: 0,
        name: `Menu ${userId}`,
        path: `user-${userId}`,
        visible: true,
        keepAlive: false,
      },
    ],
    permissions: [`permission-${userId}`],
    roles: [`role-${userId}`],
  };
}

describe('认证会话生命周期', /** 集中验证认证会话生命周期的可观察行为。 */ () => {
  const routes = [
    { name: 'Root', path: '/', component: {} },
    { name: 'Login', path: '/auth/login', component: {} },
  ];
  let router: ReturnType<typeof createRouter>;
  let auth: ReturnType<typeof useAuthStore>;
  let access: ReturnType<typeof useAccessStore>;
  let namespace: string;

  beforeEach(
    /** 为每例创建独立身份、Router 与持久化命名空间。 */ async () => {
      vi.clearAllMocks();
      vi.stubGlobal('_VBEN_ADMIN_PRO_APP_CONF_', {
        VITE_APP_STORE_SECURE_KEY: crypto.randomUUID(),
      });
      advanceSession();
      router = createRouter({ history: createMemoryHistory(), routes });
      const app = createApp({});
      app.use(router);
      namespace = `auth-tests-${crypto.randomUUID()}`;
      await initStores(app, { namespace });
      auth = app.runWithContext(
        /** 在真实 Router 注入上下文内创建认证 Store。 */ () => useAuthStore(),
      );
      access = useAccessStore();
      vi.mocked(resetRoutes).mockImplementation(
        /** 对本例 Router 执行生产动态清理与静态恢复。 */ () => {
          resetAccessibleRoutes(router);
          resetStaticRoutes(router, routes);
        },
      );
      vi.mocked(logoutApi).mockResolvedValue(undefined);
      await router.push('/');
    },
  );

  afterEach(
    /** 回收本例 Router、Store 和持久化数据并恢复全局配置。 */ () => {
      router.options.history.destroy();
      const pinia = getActivePinia();
      if (pinia) disposePinia(pinia);
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(namespace)) localStorage.removeItem(key);
      }
      vi.unstubAllGlobals();
    },
  );

  it('晚到的 A 登录不得覆盖 B，且不修改调用者的原密码', /** 安排明确的响应顺序并验证：晚到的 A 登录不得覆盖 B，且不修改调用者的原密码。 */ async () => {
    const old = deferred<ReturnType<typeof loginResult>>();
    vi.mocked(loginApi)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(loginResult(2));
    vi.mocked(getAuthPermissionInfoApi).mockResolvedValue(permission(2));
    const params = { username: 'A', password: 'test-only-input' };
    const a = auth.authLogin('username', params, keepCurrentPage);
    const rejected = expect(a).rejects.toThrow('登录会话已变更');
    await auth.authLogin(
      'username',
      { username: 'B', password: 'test-input' },
      keepCurrentPage,
    );
    old.resolve(loginResult(1));
    await rejected;
    expect(access.accessToken).toBe('test-session-2');
    expect(useUserStore().userInfo?.userId).toBe('2');
    expect(params.password).toBe('test-only-input');
  });

  it('a 的权限响应不能覆盖已经登录的 B 菜单与权限', /** 安排明确的响应顺序并验证：A 的权限响应不能覆盖已经登录的 B 菜单与权限。 */ async () => {
    const old = deferred<ReturnType<typeof permission>>();
    vi.mocked(getAuthPermissionInfoApi)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(permission(2));
    const a = auth.fetchUserInfo();
    const rejected = expect(a).rejects.toThrow('登录会话已变更');
    vi.mocked(loginApi).mockResolvedValue(loginResult(2));
    await auth.authLogin(
      'username',
      { username: 'B', password: 'test-input' },
      keepCurrentPage,
    );
    old.resolve(permission(1));
    await rejected;
    expect(access.accessCodes).toEqual(['permission-2']);
    expect(access.serverMenus).toEqual(permission(2).menus);
    expect(access.accessMenus).toEqual([]);
    expect(useUserStore().userRoles).toEqual(['role-2']);
  });

  it('退出同步清理，远端失败晚到不会清理或导航新登录', /** 安排明确的响应顺序并验证：退出同步清理，远端失败晚到不会清理或导航新登录。 */ async () => {
    const old = deferred<undefined>();
    access.setAccessToken('test-session-1');
    access.setServerMenus(permission(1).menus);
    access.setAccessMenus([{ name: 'Previous identity', path: '/a' }]);
    router.addRoute({ name: 'PrivateA', path: '/a', component: {} });
    vi.mocked(logoutApi).mockReturnValueOnce(old.promise);
    const exit = auth.logout();
    expect(access.accessToken).toBeNull();
    expect(access.serverMenus).toEqual([]);
    expect(access.accessMenus).toEqual([]);
    expect(router.hasRoute('PrivateA')).toBe(false);
    vi.mocked(loginApi).mockResolvedValue(loginResult(2));
    vi.mocked(getAuthPermissionInfoApi).mockResolvedValue(permission(2));
    await auth.authLogin(
      'username',
      { username: 'B', password: 'test-input' },
      /** 新登录完成后导航到本例静态首页。 */ async () => {
        await router.push('/');
      },
    );
    old.reject(new Error('offline'));
    await exit;
    expect(access.accessToken).toBe('test-session-2');
    expect(router.currentRoute.value.path).toBe('/');
  });

  it('旧账号改密晚到不得注销新账号', /** 安排明确的响应顺序并验证：旧账号改密晚到不得注销新账号。 */ async () => {
    const old = deferred<undefined>();
    vi.mocked(updateUserPassword).mockReturnValueOnce(old.promise);
    const change = auth.changePassword({
      oldPassword: 'old-input',
      newPassword: 'new-input',
    });
    const rejected = expect(change).rejects.toThrow('登录会话已变更');
    vi.mocked(loginApi).mockResolvedValue(loginResult(2));
    vi.mocked(getAuthPermissionInfoApi).mockResolvedValue(permission(2));
    await auth.authLogin(
      'username',
      { username: 'B', password: 'test-input' },
      keepCurrentPage,
    );
    old.resolve(undefined);
    await rejected;
    expect(access.accessToken).toBe('test-session-2');
    expect(logoutApi).not.toHaveBeenCalled();
  });

  it('当前账号改密成功后清空凭据并进入登录页', /** 安排明确的响应顺序并验证：当前账号改密成功后清空凭据并进入登录页。 */ async () => {
    access.setAccessToken('test-session-1');
    access.setRefreshToken('test-refresh-1');
    vi.mocked(updateUserPassword).mockResolvedValue(undefined);
    await auth.changePassword({
      oldPassword: 'old-input',
      newPassword: 'new-input',
    });
    expect(access.accessToken).toBeNull();
    expect(access.refreshToken).toBeNull();
    expect(router.currentRoute.value.path).toBe('/auth/login');
  });

  it('短信登录只发送手机号和验证码，不经过密码分支', /** 登录方式与参数的关联要落到真实认证动作。 */ async () => {
    vi.mocked(smsLogin).mockResolvedValue(loginResult(3));
    vi.mocked(getAuthPermissionInfoApi).mockResolvedValue(permission(3));
    const params = { mobile: 'test-mobile', code: 'test-code' };
    await auth.authLogin('mobile', params, keepCurrentPage);
    expect(smsLogin).toHaveBeenCalledWith(params);
    expect(loginApi).not.toHaveBeenCalled();
    expect(access.accessToken).toBe('test-session-3');
  });

  it('注册登录保留调用者密码，仅将请求副本转换为摘要', /** 部署允许注册时同样遵循认证身份及输入所有权约束。 */ async () => {
    vi.mocked(register).mockResolvedValue(loginResult(4));
    vi.mocked(getAuthPermissionInfoApi).mockResolvedValue(permission(4));
    const params = {
      username: 'new-user',
      password: 'test-input',
      captchaVerification: 'test-captcha',
    };
    await auth.authLogin('register', params, keepCurrentPage);
    expect(params.password).toBe('test-input');
    expect(register).toHaveBeenCalledWith({
      ...params,
      password: expect.stringMatching(/^[\da-f]{32}$/u),
    });
    expect(access.accessToken).toBe('test-session-4');
  });
});

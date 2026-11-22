/**
 * 验证认证 store 在弹窗重登录场景下的强制改密跳转与退出令牌吊销顺序。
 *
 * @author shady2713
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthPermissionInfoApi, loginApi, logoutApi } from '#/api';

import { useAuthStore } from './auth';

const routerPush = vi.fn();
const routerReplace = vi.fn();

const mockAccessState = {
  accessToken: null as null | string,
  loginExpired: false,
  refreshToken: null as null | string,
  /**
   * 写入权限码列表。
   *
   * @param _codes 权限码数组
   */
  setAccessCodes(_codes: string[]) {},
  /**
   * 写入可访问菜单。
   *
   * @param _menus 菜单数组
   */
  setAccessMenus: vi.fn((_menus: unknown[]) => {}),
  /**
   * 更新访问令牌。
   *
   * @param token 新访问令牌
   */
  setAccessToken(token: null | string) {
    mockAccessState.accessToken = token;
  },
  /**
   * 更新弹窗会话过期状态。
   *
   * @param expired 是否过期
   */
  setLoginExpired(expired: boolean) {
    mockAccessState.loginExpired = expired;
  },
  /**
   * 更新刷新令牌。
   *
   * @param token 新刷新令牌
   */
  setRefreshToken(token: null | string) {
    mockAccessState.refreshToken = token;
  },
};

const mockUserState = {
  /**
   * 写入用户信息。
   *
   * @param _user 用户信息对象
   */
  setUserInfo(_user: unknown) {},
  /**
   * 写入角色编码列表。
   *
   * @param _roles 角色列表
   */
  setUserRoles(_roles: string[]) {},
};

/**
 * 模拟 vue-router。
 *
 * @returns 带受控路由方法的 mock 模块
 */
function mockVueRouter() {
  return {
    /**
     * 返回受控路由实例。
     *
     * @returns 路由模拟对象
     */
    useRouter() {
      return {
        currentRoute: { value: { fullPath: '/system/user' } },
        push: routerPush,
        replace: routerReplace,
      };
    },
  };
}

/**
 * 模拟全局 stores。
 *
 * @returns 带受控 access/user 状态的 mock 模块
 */
function mockVbenStores() {
  return {
    /** 清空模拟令牌状态。 */
    resetAllStores() {
      mockAccessState.accessToken = null;
      mockAccessState.refreshToken = null;
    },
    /**
     * 返回模拟访问令牌 store。
     *
     * @returns 模拟访问状态对象
     */
    useAccessStore() {
      return mockAccessState;
    },
    /**
     * 返回模拟用户信息 store。
     *
     * @returns 模拟用户状态对象
     */
    useUserStore() {
      return mockUserState;
    },
  };
}

/**
 * 模拟 Element Plus 提示组件。
 *
 * @returns 带消息与通知 spy 的 mock 模块
 */
function mockElementPlus() {
  return {
    ElMessage: { warning: vi.fn() },
    ElNotification: { success: vi.fn() },
  };
}

/**
 * 模拟认证接口模块。
 *
 * @returns 带接口 spy 的 mock 模块
 */
function mockApiModule() {
  return {
    getAuthPermissionInfoApi: vi.fn(),
    loginApi: vi.fn(),
    logoutApi: vi.fn(),
    smsLogin: vi.fn(),
  };
}

/**
 * 模拟国际化翻译函数。
 *
 * @returns 原样返回 key 的翻译模块
 */
function mockLocalesModule() {
  return {
    /**
     * 返回翻译键名本身。
     *
     * @param key 国际化键名
     * @returns 原键名
     */
    $t(key: string) {
      return key;
    },
  };
}

/**
 * 模拟 SM2 密码加密模块。
 *
 * @returns 带可控密文前缀的加密模块
 */
function mockSm2Module() {
  return {
    /**
     * 生成测试用密文标记。
     *
     * @param plain 明文口令
     * @returns 带前缀的模拟密文
     */
    async encryptPassword(plain: string) {
      return `04encrypted:${plain}`;
    },
  };
}

vi.mock('vue-router', mockVueRouter);
vi.mock('@vben/stores', mockVbenStores);
vi.mock('element-plus', mockElementPlus);
vi.mock('#/api', mockApiModule);
vi.mock('#/locales', mockLocalesModule);
vi.mock('#/utils/sm2', mockSm2Module);

/** 每个用例前初始化 Pinia 并重置模拟状态。 */
function setupAuthStoreTest() {
  setActivePinia(createPinia());
  mockAccessState.accessToken = null;
  mockAccessState.refreshToken = null;
  mockAccessState.loginExpired = false;
  vi.clearAllMocks();
}

/** 验证弹窗会话过期重登录时，若账号处于强制改密状态仍必须跳转 /change-password。 */
async function redirectsToChangePasswordDuringModalRelogin() {
  mockAccessState.loginExpired = true;
  vi.mocked(loginApi).mockResolvedValue({
    accessToken: 'CHANGE_ME_ACCESS_TOKEN',
    expiresTime: Date.now() + 60_000,
    passwordChangeRequired: true,
    refreshToken: 'CHANGE_ME_REFRESH_TOKEN',
    userId: 1,
  });
  vi.mocked(getAuthPermissionInfoApi).mockResolvedValue({
    menus: [],
    permissions: [],
    roles: ['super_admin'],
    user: {
      avatar: '',
      deptId: 1,
      id: 1,
      nickname: '管理员',
      passwordChangeRequired: true,
      userType: 'super_admin',
      username: 'admin',
    },
  });

  const authStore = useAuthStore();
  await authStore.authLogin('username', {
    password: 'CHANGE_ME_PASSWORD',
    username: 'admin',
  });

  expect(mockAccessState.loginExpired).toBe(false);
  expect(authStore.passwordChangeRequired).toBe(true);
  expect(routerPush).toHaveBeenCalledWith('/change-password');
}

/** 验证退出登录时先携带当前访问令牌调用后端注销，再清空本地状态。 */
async function revokesServerTokenBeforeClearingStoreOnLogout() {
  mockAccessState.accessToken = 'CHANGE_ME_ACTIVE_TOKEN';
  let tokenObservedInLogoutApi: null | string = null;
  /**
   * 记录调用 logoutApi 时尚未清空的令牌。
   *
   * @param token 传入的访问令牌
   */
  async function captureLogoutToken(token: string) {
    tokenObservedInLogoutApi = token;
  }
  vi.mocked(logoutApi).mockImplementation(captureLogoutToken as any);

  const authStore = useAuthStore();
  await authStore.logout(true);

  expect(tokenObservedInLogoutApi).toBe('CHANGE_ME_ACTIVE_TOKEN');
  expect(mockAccessState.accessToken).toBeNull();
  expect(routerReplace).toHaveBeenCalledTimes(1);
}

/** 验证非弹窗登录阶段拉取用户信息失败时回滚已写入的令牌，防止半登录态残留。 */
async function clearsTokensWhenFetchUserInfoFailsDuringNormalLogin() {
  vi.mocked(loginApi).mockResolvedValue({
    accessToken: 'CHANGE_ME_NEW_ACCESS',
    passwordChangeRequired: false,
    refreshToken: 'CHANGE_ME_NEW_REFRESH',
  } as any);
  vi.mocked(getAuthPermissionInfoApi).mockRejectedValue(
    new Error('permission service unavailable'),
  );

  const authStore = useAuthStore();
  await expect(
    authStore.authLogin('username', {
      password: 'CHANGE_ME_PASSWORD',
      username: 'admin',
    }),
  ).rejects.toThrow('permission service unavailable');

  expect(mockAccessState.accessToken).toBeNull();
  expect(mockAccessState.refreshToken).toBeNull();
}

/** 验证弹窗重登录拉取权限失败时回滚新令牌，且成功时不以原始菜单覆盖已转换菜单。 */
async function preservesMenusAndRollsBackTokensDuringModalRelogin() {
  mockAccessState.loginExpired = true;
  mockAccessState.accessToken = 'CHANGE_ME_PREV_ACCESS';
  mockAccessState.refreshToken = 'CHANGE_ME_PREV_REFRESH';
  vi.mocked(loginApi).mockResolvedValue({
    accessToken: 'CHANGE_ME_MODAL_ACCESS',
    passwordChangeRequired: true,
    refreshToken: 'CHANGE_ME_MODAL_REFRESH',
  } as any);
  vi.mocked(getAuthPermissionInfoApi).mockRejectedValueOnce(
    new Error('modal fetch failed'),
  );

  const authStore = useAuthStore();
  await expect(
    authStore.authLogin('username', {
      password: 'CHANGE_ME_PASSWORD',
      username: 'admin',
    }),
  ).rejects.toThrow('modal fetch failed');
  expect(mockAccessState.accessToken).toBe('CHANGE_ME_PREV_ACCESS');
  expect(mockAccessState.refreshToken).toBe('CHANGE_ME_PREV_REFRESH');
  expect(authStore.passwordChangeRequired).toBe(false);

  vi.mocked(getAuthPermissionInfoApi).mockResolvedValueOnce({
    menus: [{ id: 1, name: 'raw' }],
    permissions: ['system:user:query'],
    roles: ['super_admin'],
    user: { id: 1, nickname: '管理员', username: 'admin' },
  } as any);
  await authStore.authLogin('username', {
    password: 'CHANGE_ME_PASSWORD',
    username: 'admin',
  });
  expect(mockAccessState.setAccessMenus).not.toHaveBeenCalled();
}

/** 认证 store 行为测试套件。 */
function authStoreSuite() {
  beforeEach(setupAuthStoreTest);

  it(
    '弹窗过期重登录命中强制改密时仍跳转至 /change-password',
    redirectsToChangePasswordDuringModalRelogin,
  );
  it(
    '退出登录时在清空本地状态前向后端吊销当前访问令牌',
    revokesServerTokenBeforeClearingStoreOnLogout,
  );
  it(
    '普通登录拉取权限信息失败时回滚已写入令牌',
    clearsTokensWhenFetchUserInfoFailsDuringNormalLogin,
  );
  it(
    '弹窗重登录失败回滚令牌且成功不覆盖已转换菜单',
    preservesMenusAndRollsBackTokensDuringModalRelogin,
  );
}

describe('useAuthStore', authStoreSuite);

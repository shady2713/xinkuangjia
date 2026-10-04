/** 通过真实认证 API 验证不可信 HTTP 值必须先通过运行时契约。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkCaptcha,
  getAuthPermissionInfoApi,
  getCaptcha,
  loginApi,
  logoutApi,
  refreshTokenApi,
  register,
  sendSmsCode,
  smsLogin,
  smsResetPassword,
} from './auth';

const transport = vi.hoisted(
  /** 只替换网络收发边界，保留各 API 的解析逻辑。 */ () => ({
    get: vi.fn(),
    post: vi.fn(),
    rawPost: vi.fn(),
  }),
);

vi.mock(
  '#/api/request',
  /** 提供未知响应，避免泛型声明替代运行时验证。 */ () => ({
    requestClient: { get: transport.get, post: transport.post },
    baseRequestClient: { post: transport.rawPost },
  }),
);

/** 服务端 LocalDateTime 的 Jackson 序列化契约为毫秒整数。 */
function login() {
  return {
    accessToken: 'DUMMY-test-access',
    refreshToken: 'DUMMY-test-refresh',
    userId: 1,
    expiresTime: 1_900_000_000_000,
  };
}

/** 模拟真实权限 VO：无前端 meta、组件对象及 userId 展示字段。 */
function permission() {
  return {
    user: {
      id: 1,
      username: 'admin',
      nickname: 'Admin',
      avatar: null,
      email: null,
      deptId: null,
      userType: 'super_admin',
    },
    roles: ['admin'],
    permissions: ['system:user:list', ''],
    menus: [
      {
        id: 10,
        parentId: 0,
        name: 'System',
        path: 'system',
        component: null,
        componentName: null,
        icon: null,
        visible: true,
        keepAlive: false,
        children: null,
      },
    ],
  };
}

describe('认证响应契约', /** 验证正常数据、边界值及拒绝错误值均经过实际 API。 */ () => {
  beforeEach(
    /** 清理各 API 的传输结果。 */ () => {
      vi.clearAllMocks();
    },
  );

  it('普通登录只返回已验证凭据字段', /** 多余传输字段不能扩散到状态。 */ async () => {
    transport.post.mockResolvedValue({ ...login(), unexpected: 'ignored' });
    await expect(
      loginApi({ username: 'admin', password: 'DUMMY-test-input' }),
    ).resolves.toEqual(login());
    expect(transport.post).toHaveBeenCalledWith(
      '/system/auth/super-admin-login',
      { username: 'admin', password: 'DUMMY-test-input' },
      { headers: { isEncrypt: false } },
    );
  });

  it.each([
    ['缺失访问令牌', { ...login(), accessToken: undefined }],
    ['空刷新令牌', { ...login(), refreshToken: ' ' }],
    ['换行令牌', { ...login(), accessToken: 'DUMMY-test\nvalue' }],
    ['丢失精度的编号', { ...login(), userId: Number.MAX_SAFE_INTEGER + 1 }],
    ['字符串时间', { ...login(), expiresTime: '1900000000000' }],
    ['非对象结果', []],
  ])(
    '拒绝%s',
    /** 不能通过 TypeScript 泛型让畸形凭据进入状态。 */ async (
      _name,
      value,
    ) => {
      transport.post.mockResolvedValue(value);
      await expect(
        loginApi({ username: 'admin', password: 'DUMMY-test-input' }),
      ).rejects.toBeInstanceOf(TypeError);
    },
  );

  it('短信与注册入口同样校验凭据', /** 辅助登录方式不能绕过主入口边界。 */ async () => {
    transport.post.mockResolvedValue({ accessToken: 'DUMMY-test-only' });
    await expect(
      smsLogin({ mobile: 'test-mobile', code: 'test-code' }),
    ).rejects.toThrow('refreshToken');
    await expect(
      register({
        username: 'test-user',
        password: 'DUMMY-test-input',
        captchaVerification: 'test-captcha',
      }),
    ).rejects.toThrow('refreshToken');
  });

  it('刷新同时校验业务成功标记与凭据', /** HTTP 成功不能替代业务成功或凭据有效。 */ async () => {
    transport.rawPost.mockResolvedValueOnce({
      data: { code: 0, data: login() },
    });
    await expect(refreshTokenApi('DUMMY-test-refresh')).resolves.toEqual(
      login(),
    );
    transport.rawPost.mockResolvedValueOnce({
      data: { code: 401, msg: 'expired', data: login() },
    });
    await expect(refreshTokenApi('DUMMY-test-refresh')).rejects.toThrow(
      'expired',
    );
    transport.rawPost.mockResolvedValueOnce({
      data: { code: 0, data: { ...login(), refreshToken: null } },
    });
    await expect(refreshTokenApi('DUMMY-test-refresh')).rejects.toThrow(
      'refreshToken',
    );
  });

  it('规范化真实用户及菜单模型，保留合法空权限和空展示字段', /** 对可空字段使用协议约定，不能误拒绝正常后端值。 */ async () => {
    transport.get.mockResolvedValue(permission());
    const result = await getAuthPermissionInfoApi();
    expect(result.user).toEqual({
      id: 1,
      userId: '1',
      username: 'admin',
      nickname: 'Admin',
      avatar: '',
      email: '',
      deptId: null,
      userType: 'super_admin',
    });
    expect(result.permissions).toEqual(['system:user:list', '']);
    expect(result.menus).toEqual([
      {
        id: 10,
        parentId: 0,
        name: 'System',
        path: 'system',
        component: '',
        componentName: '',
        icon: '',
        visible: true,
        keepAlive: false,
      },
    ]);
  });

  it('拒绝权限数组中的非字符串及字符串布尔字段', /** 授权及菜单可见性必须严格匹配后端类型。 */ async () => {
    transport.get.mockResolvedValueOnce({
      ...permission(),
      permissions: ['allowed', {}],
    });
    await expect(getAuthPermissionInfoApi()).rejects.toThrow('permissions[1]');
    transport.get.mockResolvedValueOnce({
      ...permission(),
      menus: [{ ...permission().menus[0], visible: 'false' }],
    });
    await expect(getAuthPermissionInfoApi()).rejects.toThrow('menu.visible');
  });

  it('拒绝嵌套非法菜单且不回显凭据值', /** 整棵权限树通过前不能发布其中部分路由。 */ async () => {
    transport.get.mockResolvedValue({
      ...permission(),
      menus: [
        {
          ...permission().menus[0],
          children: [{ ...permission().menus[0], id: -1 }],
        },
      ],
    });
    await expect(getAuthPermissionInfoApi()).rejects.toThrow('menu.id');
    transport.post.mockResolvedValue({
      ...login(),
      accessToken: { privateValue: 'must-not-appear' },
    });
    await expect(
      loginApi({ username: 'admin', password: 'DUMMY-test-input' }),
    ).rejects.not.toThrow('must-not-appear');
  });
});

describe('认证辅助入口', /** 退出、验证码、短信与重置密码入口的地址、凭据头与透传契约。 */ () => {
  beforeEach(
    /** 清理各 API 的传输结果。 */ () => {
      vi.clearAllMocks();
    },
  );

  it('退出登录携带当前身份的 Bearer 令牌且不发送请求体', /** 缺少 Bearer 前缀会让服务端无法撤销本次会话的令牌。 */ async () => {
    transport.rawPost.mockResolvedValue({ data: true });

    await expect(logoutApi('DUMMY-test-access')).resolves.toEqual({
      data: true,
    });
    expect(transport.rawPost).toHaveBeenCalledWith(
      '/system/auth/logout',
      {},
      { headers: { Authorization: 'Bearer DUMMY-test-access' } },
    );
  });

  it('验证码获取与校验都走无认证客户端并原样透传请求体', /** 未登录时也要能取验证码，响应体必须原样交给组件解密。 */ async () => {
    const request = { captchaType: 'blockPuzzle' };
    transport.rawPost.mockResolvedValueOnce({
      originalImageBase64: 'DUMMY-test-image',
      repCode: '0000',
      token: 'DUMMY-test-token',
    });
    await expect(getCaptcha(request)).resolves.toEqual({
      originalImageBase64: 'DUMMY-test-image',
      repCode: '0000',
      token: 'DUMMY-test-token',
    });
    expect(transport.rawPost).toHaveBeenNthCalledWith(
      1,
      '/system/captcha/get',
      request,
    );

    transport.rawPost.mockResolvedValueOnce({ repCode: '0000', repMsg: '' });
    await expect(checkCaptcha(request)).resolves.toEqual({
      repCode: '0000',
      repMsg: '',
    });
    expect(transport.rawPost).toHaveBeenNthCalledWith(
      2,
      '/system/captcha/check',
      request,
    );
  });

  it('短信验证码与短信重置密码走业务客户端并原样透传参数', /** 两个入口共用业务客户端，地址写反会把重置密码发到验证码接口。 */ async () => {
    transport.post.mockResolvedValue(true);

    await expect(
      sendSmsCode({ mobile: 'test-mobile', scene: 1 }),
    ).resolves.toBe(true);
    expect(transport.post).toHaveBeenNthCalledWith(
      1,
      '/system/auth/send-sms-code',
      { mobile: 'test-mobile', scene: 1 },
    );

    await expect(
      smsResetPassword({
        code: 'test-code',
        mobile: 'test-mobile',
        password: 'DUMMY-test-input',
      }),
    ).resolves.toBe(true);
    expect(transport.post).toHaveBeenNthCalledWith(
      2,
      '/system/auth/reset-password',
      {
        code: 'test-code',
        mobile: 'test-mobile',
        password: 'DUMMY-test-input',
      },
    );
  });
});

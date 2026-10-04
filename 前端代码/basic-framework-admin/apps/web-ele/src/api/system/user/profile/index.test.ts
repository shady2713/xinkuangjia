/**
 * 个人中心接口（profile/index.ts）的请求契约回归。
 *
 * 三个入口是个人中心页面的唯一数据边界：读取当前登录用户资料、更新资料、修改密码。
 * 用例只替换网络收发边界，断言真实请求方法、路径与请求体，并核对返回值原样透传。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getUserProfile, updateUserPassword, updateUserProfile } from './index';

const transport = vi.hoisted(
  /** 只替换网络收发边界，保留各接口的参数组装逻辑。 */ () => ({
    get: vi.fn(),
    put: vi.fn(),
  }),
);

vi.mock(
  '#/api/request',
  /** 提供可观察的请求客户端替身，避免测试发起真实网络请求。 */ () => ({
    requestClient: { get: transport.get, put: transport.put },
  }),
);

describe('个人中心接口请求契约', /** 三个入口的方法、路径与请求体。 */ () => {
  beforeEach(
    /** 每个用例从干净的调用记录出发，避免跨用例统计。 */ () => {
      transport.get.mockReset();
      transport.put.mockReset();
    },
  );

  it('读取登录用户资料使用 GET 与固定路径', /** 资料读取是无副作用查询，方法或路径变化会让页面拿不到数据。 */ async () => {
    const profile = { id: 1, nickname: '管理员' };
    transport.get.mockResolvedValue(profile);

    await expect(getUserProfile()).resolves.toBe(profile);
    expect(transport.get).toHaveBeenCalledTimes(1);
    expect(transport.get).toHaveBeenCalledWith('/system/user/profile/get');
  });

  it('更新个人资料原样提交请求体', /** 资料字段由表单决定，接口层不得裁剪或改写任何字段。 */ async () => {
    const payload = {
      avatar: 'https://example.test/avatar.png',
      email: 'user@example.test',
      mobile: '13800000000',
      nickname: '新昵称',
      sex: 1,
    };
    transport.put.mockResolvedValue(true);

    await expect(updateUserProfile(payload)).resolves.toBe(true);
    expect(transport.put).toHaveBeenCalledWith(
      '/system/user/profile/update',
      payload,
    );
  });

  it('修改密码原样提交新旧口令', /** 口令字段名是后端契约，改动会导致改密失败或提交到错误接口。 */ async () => {
    const payload = { newPassword: 'CHANGE_ME-new', oldPassword: 'DUMMY-old' };
    transport.put.mockResolvedValue(true);

    await expect(updateUserPassword(payload)).resolves.toBe(true);
    expect(transport.put).toHaveBeenCalledWith(
      '/system/user/profile/update-password',
      payload,
    );
  });

  it('传输失败时保留原始错误', /** 接口层不得吞掉或改写失败原因，调用方需要按真实错误提示。 */ async () => {
    const failure = new Error('网络不可用');
    transport.get.mockRejectedValue(failure);

    await expect(getUserProfile()).rejects.toBe(failure);
  });
});

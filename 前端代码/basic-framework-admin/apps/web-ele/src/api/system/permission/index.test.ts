/**
 * 角色与用户授权接口（apps/web-ele 的 api/system/permission）真实请求契约回归。
 *
 * 该模块承担角色菜单、角色数据范围与用户角色的读写：地址或查询串拼错会让权限分配落到
 * 别的资源、把角色授权写给别人，载荷字段名写错会让后端收到空授权。用例只替换网络收发
 * 边界，断言每个导出函数真实发出的方法、地址与载荷，并核对角色编号与用户编号确实进入
 * 查询串而不是被静默丢弃。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  assignRoleDataScope,
  assignRoleMenu,
  assignUserRole,
  getRoleMenuList,
  getUserRoleList,
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，各接口的地址与参数拼装保持真实实现。 */ () => ({
    requestClient: {
      get: vi.fn(),
      post: vi.fn(),
    },
  }),
);

beforeEach(
  /** 每例独立提供响应，不继承上例的调用记录。 */ () => {
    vi.resetAllMocks();
  },
);

describe('角色菜单授权接口', /** 角色菜单授权决定角色能看到哪些菜单，编号拼错会改错角色。 */ () => {
  it('按角色编号查询已分配菜单', /** 角色编号必须进入查询串，否则后端无法定位角色。 */ async () => {
    await getRoleMenuList(12);

    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/permission/list-role-menus?roleId=12',
    );
    expect(requestClient.get).toHaveBeenCalledTimes(1);
  });

  it('原样提交角色菜单覆盖式载荷', /** 载荷被改写会让未勾选的菜单仍然保留授权。 */ async () => {
    const payload = { menuIds: [1, 2, 3], roleId: 12 };

    await assignRoleMenu(payload);

    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/permission/assign-role-menu',
      payload,
    );
  });
});

describe('角色数据范围授权接口', /** 数据范围决定角色可见的部门集合，字段缺失会退化成默认范围。 */ () => {
  it('原样提交数据范围与部门编号集合', /** 数据范围类型被丢弃会让角色看到全部数据。 */ async () => {
    const payload = { dataScope: 4, dataScopeDeptIds: [7, 8], roleId: 12 };

    await assignRoleDataScope(payload);

    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/permission/assign-role-data-scope',
      payload,
    );
  });
});

describe('用户角色授权接口', /** 用户角色授权决定账号权限，用户编号拼错会把权限发给别人。 */ () => {
  it('按用户编号查询已分配角色并保留返回类型', /** 用户编号必须进入查询串，返回值即角色编号集合。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([3, 5]);

    await expect(getUserRoleList(21)).resolves.toEqual([3, 5]);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/permission/list-user-roles?userId=21',
    );
  });

  it('原样提交用户角色覆盖式载荷', /** 载荷被改写会让未勾选的角色仍然保留授权。 */ async () => {
    const payload = { roleIds: [3, 5], userId: 21 };

    await assignUserRole(payload);

    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/permission/assign-user-role',
      payload,
    );
  });
});

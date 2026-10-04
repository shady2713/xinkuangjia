/**
 * 角色接口（api/system/role）的地址、方法与参数契约回归。
 *
 * 角色页的增删改查共用同一批路径，只能靠 HTTP 方法区分；主键与批量编号写在查询串里，
 * 拼装方式写错会改到、删到错误角色。用例只替换网络收发边界，接口自身的地址拼装与
 * 参数透传保持真实实现，并断言返回结果原样交给调用方。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createRole,
  deleteRole,
  deleteRoleList,
  exportRole,
  getRole,
  getRolePage,
  getSimpleRoleList,
  updateRole,
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，保留接口自身的地址、方法与参数拼装逻辑。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      download: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  }),
);

/** 构造字段完整的角色记录，作为详情与写操作的合法基线。 */
function roleRecord() {
  return {
    code: 'system_admin',
    dataScope: 1,
    dataScopeDeptIds: [1, 2],
    id: 5,
    name: '系统管理员',
    sort: 1,
    status: 0,
    type: 1,
  };
}

describe('角色查询', /** 列表、精简列表与详情的地址和参数口径不同，必须分别核对。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数丢失会让列表退化成后端默认首页。 */ async () => {
    const page = { list: [roleRecord()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getRolePage({ pageNo: 3, pageSize: 50 })).resolves.toBe(page);
    expect(requestClient.get).toHaveBeenCalledWith('/system/role/page', {
      params: { pageNo: 3, pageSize: 50 },
    });
  });

  it('精简列表按固定地址返回下拉数据', /** 下拉选项的地址写错会让角色选择器永远为空。 */ async () => {
    const roles = [{ id: 5, name: '系统管理员' }];
    vi.mocked(requestClient.get).mockResolvedValue(roles);

    await expect(getSimpleRoleList()).resolves.toBe(roles);
    expect(requestClient.get).toHaveBeenCalledWith('/system/role/simple-list');
  });

  it('按主键查询详情时把编号写入查询串', /** 编号丢失会让详情落到错误角色或后端参数校验失败。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue(roleRecord());

    await expect(getRole(5)).resolves.toEqual(roleRecord());
    expect(requestClient.get).toHaveBeenCalledWith('/system/role/get?id=5');
  });

  it('查询失败时向调用方传播原始错误', /** 请求层错误被吞掉会让页面把失败显示成空列表。 */ async () => {
    const failure = new Error('角色查询失败');
    vi.mocked(requestClient.get).mockRejectedValue(failure);

    await expect(getRolePage({ pageNo: 1, pageSize: 10 })).rejects.toBe(
      failure,
    );
  });
});

describe('角色写操作', /** 增删改共用路径，方法与请求体是后端约定的直接体现。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增角色使用 POST 并提交完整请求体', /** 方法与请求体写错会让新增落到更新或丢失字段。 */ async () => {
    const payload = roleRecord();
    vi.mocked(requestClient.post).mockResolvedValue(5);

    await expect(createRole(payload)).resolves.toBe(5);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/role/create',
      payload,
    );
  });

  it('修改角色使用 PUT 并提交完整请求体', /** 与新增共用路径时必须靠方法区分，否则会新增出重复角色。 */ async () => {
    const payload = roleRecord();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateRole(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/role/update',
      payload,
    );
  });

  it('按主键删除单个角色', /** 删除编号必须进入查询串，避免删错角色。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteRole(5)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/role/delete?id=5',
    );
  });

  it('批量删除用逗号拼接编号', /** 分隔符由后端约定，写错会漏删或多删。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteRoleList([3, 5, 8])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/role/delete-list?ids=3,5,8',
    );
  });

  it('批量删除空集合时只提交空编号串', /** 空选择不能退化成删除全部，必须保持显式空参数。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteRoleList([])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/role/delete-list?ids=',
    );
  });

  it('删除失败时向调用方传播原始错误', /** 失败被吞掉会让页面在角色仍存在时提示删除成功。 */ async () => {
    const failure = new Error('角色删除失败');
    vi.mocked(requestClient.delete).mockRejectedValue(failure);

    await expect(deleteRole(5)).rejects.toBe(failure);
  });
});

describe('角色导出', /** 导出沿用页面筛选条件且不接受分页参数。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('把筛选条件交给导出接口并原样返回文件流', /** 下载地址或参数结构变化会让用户拿到空文件或错误文件。 */ async () => {
    const file = new Blob(['DUMMY-role-export']);
    vi.mocked(requestClient.download).mockResolvedValue(file);

    await expect(
      exportRole({ code: 'system_admin', name: '系统管理员' }),
    ).resolves.toBe(file);
    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/role/export-excel',
      { params: { code: 'system_admin', name: '系统管理员' } },
    );
  });

  it('导出失败时向调用方传播原始错误', /** 失败必须让调用方停止下载动作，而不是触发一次空文件下载。 */ async () => {
    const failure = new Error('角色导出失败');
    vi.mocked(requestClient.download).mockRejectedValue(failure);

    await expect(exportRole({ name: '系统管理员' })).rejects.toBe(failure);
  });
});

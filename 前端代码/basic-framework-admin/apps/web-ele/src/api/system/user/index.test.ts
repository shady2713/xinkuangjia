/**
 * 用户管理接口（apps/web-ele 的 api/system/user）真实请求契约回归。
 *
 * 该模块是用户管理页与后端之间唯一的请求入口：路径、HTTP 方法或载荷字段写错会让分页、
 * 增删改、导入导出与状态变更打到错误接口或丢字段。用例只替换网络收发边界，断言每个导出
 * 函数真实发出的方法、地址与参数，并核对返回值原样透传。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createUser,
  deleteUser,
  deleteUserList,
  exportUser,
  getSimpleUserList,
  getUser,
  getUserPage,
  importUser,
  importUserTemplate,
  resetUserPassword,
  updateUser,
  updateUserStatus,
} from './index';

/**
 * 新增用户接口的入参类型；用它约束样本载荷，字段缺失会在类型检查阶段暴露。
 */
type UserPayload = Parameters<typeof createUser>[0];

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，各接口的地址与参数拼装保持真实实现。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      download: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      upload: vi.fn(),
    },
  }),
);

/** 后端返回的分页结果样本，用于核对返回值透传。 */
const pageResult = { list: [], total: 0 };

/** 一份最小的用户写入载荷。 */
const userPayload = {
  avatar: '',
  deptId: 1,
  email: 'DUMMY-user@example.test',
  loginIp: '',
  mobile: 'DUMMY-13800000000',
  nickname: '测试用户',
  postIds: ['1'],
  remark: '',
  sex: 1,
  status: 0,
  username: 'DUMMY-user',
} satisfies UserPayload;

beforeEach(
  /** 每例独立提供响应，不继承上例结果。 */ () => {
    vi.resetAllMocks();
  },
);

describe('用户查询接口', /** 查询类接口的地址与参数拼装。 */ () => {
  it('分页查询按原样传递分页参数并返回结果', /** 参数被丢弃会让分页与筛选条件失效。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue(pageResult);
    const params = { pageNo: 2, pageSize: 10, username: 'DUMMY-user' };

    const result = await getUserPage(params);

    expect(requestClient.get).toHaveBeenCalledWith('/system/user/page', {
      params,
    });
    expect(result).toBe(pageResult);
  });

  it('按主键查询把编号拼进查询串', /** 查询串写错会取到别的用户或 404。 */ async () => {
    await getUser(7);

    expect(requestClient.get).toHaveBeenCalledWith('/system/user/get?id=7');
  });

  it('精简列表不带任何参数', /** 精简列表接口不接受分页，多传参数会改变后端行为。 */ async () => {
    await getSimpleUserList();

    expect(requestClient.get).toHaveBeenCalledWith('/system/user/simple-list');
  });
});

describe('用户写入接口', /** 写入类接口的方法与载荷。 */ () => {
  it('新增与修改使用各自的 HTTP 方法', /** 方法写反会让新增覆盖已有记录或修改新建脏数据。 */ async () => {
    await createUser(userPayload);
    await updateUser(userPayload);

    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/user/create',
      userPayload,
    );
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/user/update',
      userPayload,
    );
  });

  it('单条与批量删除按不同路径传参', /** 批量删除漏拼编号会删不掉或多删数据。 */ async () => {
    await deleteUser(3);
    await deleteUserList([1, 2, 3]);

    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/user/delete?id=3',
    );
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/user/delete-list?ids=1,2,3',
    );
  });

  it('空集合批量删除仍发出请求且编号为空', /** 静默跳过或拼出 undefined 会让调用方以为删除已提交。 */ async () => {
    await deleteUserList([]);

    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/user/delete-list?ids=',
    );
  });

  it('重置密码与状态变更新增专用载荷', /** 载荷字段写错会让密码或状态更新失败且难以定位。 */ async () => {
    await resetUserPassword(9, 'DUMMY-new-password');
    await updateUserStatus(9, 0);

    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/user/update-password',
      { id: 9, password: 'DUMMY-new-password' },
    );
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/user/update-status',
      { id: 9, status: 0 },
    );
  });
});

describe('用户导入导出接口', /** 下载与上传接口的边界。 */ () => {
  it('按当前筛选条件导出且不带分页参数', /** 导出混入分页参数会让导出结果缺行。 */ async () => {
    const params = { username: 'DUMMY-user' };

    await exportUser(params);

    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/user/export-excel',
      { params },
    );
  });

  it('下载导入模板不带参数', /** 模板地址写错会下载到错误文件。 */ async () => {
    await importUserTemplate();

    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/user/get-import-template',
    );
  });

  it('导入时提交真实文件与覆盖开关', /** 字段名写错会让后端收不到文件或覆盖标记。 */ async () => {
    const file = new File(['DUMMY-content'], 'users.xlsx');

    await importUser(file, true);

    expect(requestClient.upload).toHaveBeenCalledWith('/system/user/import', {
      file,
      updateSupport: true,
    });
  });
});

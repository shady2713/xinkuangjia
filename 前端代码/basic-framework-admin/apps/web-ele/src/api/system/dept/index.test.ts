/**
 * 部门接口（api/system/dept）的响应契约与请求参数回归。
 *
 * 部门数据既用于组织树选择器也用于增删改；编号或可空字段未经验证会让选择器渲染出
 * 错误节点，地址或方法写错会让增删改落到错误接口。用例只替换网络边界，保留接口自身的
 * 字段校验与参数拼装逻辑，断言真实调用地址、请求体与返回结果。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createDept,
  deleteDept,
  deleteDeptList,
  getDept,
  getDeptList,
  getSimpleDeptList,
  updateDept,
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络边界，保留接口自身的字段校验与参数拼装。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  }),
);

/** 构造字段完整的部门响应记录，作为各用例的合法基线。 */
function validDept() {
  return {
    createTime: 1_700_000_000_000,
    email: 'leader@example.test',
    id: 12,
    leaderUserId: 7,
    name: '研发部',
    parentId: 1,
    phone: '13800000000',
    sort: 3,
    status: 0,
  };
}

describe('部门列表查询', /** 精简列表与完整列表的校验口径不同，必须分别核对。 */ () => {
  beforeEach(
    /** 每例独立提供响应，不继承上例结果。 */ () => vi.resetAllMocks(),
  );

  it('精简列表直接返回接口结果', /** 精简列表由接口保证字段，页面按原样用于下拉选择。 */ async () => {
    const depts = [{ id: 1, name: '总部' }];
    vi.mocked(requestClient.get).mockResolvedValue(depts);

    await expect(getSimpleDeptList()).resolves.toBe(depts);
    expect(requestClient.get).toHaveBeenCalledWith('/system/dept/simple-list');
  });

  it('完整列表校验并规范化可选字段', /** 可空负责人与联系方式必须归一为空值，避免渲染出 undefined。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([
      {
        ...validDept(),
        email: undefined,
        leaderUserId: undefined,
        phone: null,
      },
      validDept(),
    ]);

    await expect(getDeptList()).resolves.toEqual([
      {
        createTime: 1_700_000_000_000,
        email: '',
        id: 12,
        leaderUserId: null,
        name: '研发部',
        parentId: 1,
        phone: '',
        sort: 3,
        status: 0,
      },
      validDept(),
    ]);
    expect(requestClient.get).toHaveBeenCalledWith('/system/dept/list');
  });

  it('完整列表丢弃传输中的多余字段', /** 多余字段不能扩散到页面数据模型。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([
      { ...validDept(), unexpected: 'ignored' },
    ]);

    await expect(getDeptList()).resolves.toEqual([validDept()]);
  });

  it('响应不是数组时拒绝', /** 泛型声明不能保证传输值是数组。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue({ data: [] });

    await expect(getDeptList()).rejects.toThrow('部门列表必须是数组');
  });

  it.each([
    ['记录不是对象', 'not-an-object'],
    ['缺少正整数编号', { id: 0 }],
    ['编号超出安全整数', { id: Number.MAX_SAFE_INTEGER + 1 }],
    ['父编号为负数', { parentId: -1 }],
    ['名称为数字', { name: 1 }],
    ['状态不是整数', { status: 1.5 }],
    ['排序不是整数', { sort: '1' }],
    ['负责人编号非法', { leaderUserId: 1.5 }],
    ['电话不是字符串', { phone: 138 }],
    ['邮箱不是字符串', { email: {} }],
    ['创建时间不是安全整数', { createTime: 1.5 }],
  ])(
    '完整列表拒绝%s的部门记录',
    /** 非法字段会让树形选择器产生错误节点或错误请求。 */ async (
      _name,
      patch,
    ) => {
      vi.mocked(requestClient.get).mockResolvedValue([
        typeof patch === 'string' ? patch : { ...validDept(), ...patch },
      ]);

      await expect(getDeptList()).rejects.toThrow('部门响应字段无效');
    },
  );
});

describe('部门详情与写操作地址', /** 增删改接口地址与请求体是后端约定的直接体现。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => vi.resetAllMocks(),
  );

  it('按编号查询详情', /** 编号必须进入查询串，否则会返回错误部门。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue(validDept());

    await expect(getDept(12)).resolves.toEqual(validDept());
    expect(requestClient.get).toHaveBeenCalledWith('/system/dept/get?id=12');
  });

  it('新增部门提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据。 */ async () => {
    const payload = validDept();
    vi.mocked(requestClient.post).mockResolvedValue(12);

    await expect(createDept(payload)).resolves.toBe(12);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/dept/create',
      payload,
    );
  });

  it('修改部门使用 PUT', /** 修改与新增共用路径时必须靠方法区分。 */ async () => {
    const payload = validDept();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateDept(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/dept/update',
      payload,
    );
  });

  it('按编号删除单个部门', /** 删除编号必须进入查询串，避免删错部门。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteDept(12)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/dept/delete?id=12',
    );
  });

  it('批量删除用逗号拼接编号', /** 批量删除的编号分隔符由后端约定，写错会漏删或多删。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteDeptList([3, 5, 8])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/dept/delete-list?ids=3,5,8',
    );
  });
});

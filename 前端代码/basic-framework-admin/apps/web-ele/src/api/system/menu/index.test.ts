/**
 * 菜单管理接口（apps/web-ele 的 api/system/menu）真实请求契约回归。
 *
 * 菜单接口的地址与载荷决定菜单树、权限标识和路由配置能否正确读写：路径写错会让菜单管理页
 * 打到别的资源，批量删除漏拼编号会删错数据。用例只替换网络收发边界，断言每个导出函数真实
 * 发出的方法、地址与参数，并核对查询串中的编号拼接方式。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createMenu,
  deleteMenu,
  deleteMenuList,
  getMenu,
  getMenuList,
  getSimpleMenusList,
  updateMenu,
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，各接口的地址与参数拼装保持真实实现。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  }),
);

/** 一份最小的菜单写入载荷，字段与后端菜单模型对齐。 */
const menuPayload = {
  component: 'system/menu/index',
  createTime: new Date('2026-01-01T00:00:00Z'),
  icon: 'ep:menu',
  id: 1,
  keepAlive: true,
  name: 'SystemMenu',
  parentId: 0,
  path: '/system/menu',
  permission: 'system:menu:list',
  sort: 1,
  status: 0,
  type: 2,
  visible: true,
} satisfies Parameters<typeof createMenu>[0];

beforeEach(
  /** 每例独立提供响应，不继承上例结果。 */ () => {
    vi.resetAllMocks();
  },
);

describe('菜单查询接口', /** 查询类接口的地址与参数拼装。 */ () => {
  it('精简列表不带任何参数', /** 精简列表用于下拉与父菜单选择，多传参数会改变后端返回。 */ async () => {
    await getSimpleMenusList();

    expect(requestClient.get).toHaveBeenCalledWith('/system/menu/simple-list');
  });

  it('列表查询按原样传递筛选条件', /** 筛选条件被丢弃会让菜单管理页始终显示全量数据。 */ async () => {
    const params = { name: '菜单', status: 0 };

    await getMenuList(params);

    expect(requestClient.get).toHaveBeenCalledWith('/system/menu/list', {
      params,
    });
  });

  it('不传筛选条件时不构造空参数对象', /** 传空对象会让后端把缺省筛选当成显式条件。 */ async () => {
    await getMenuList();

    expect(requestClient.get).toHaveBeenCalledWith('/system/menu/list', {
      params: undefined,
    });
  });

  it('按主键查询把编号拼进查询串', /** 查询串写错会取到别的菜单或 404。 */ async () => {
    await getMenu(12);

    expect(requestClient.get).toHaveBeenCalledWith('/system/menu/get?id=12');
  });
});

describe('菜单写入接口', /** 写入类接口的方法与载荷。 */ () => {
  it('新增与修改使用各自的 HTTP 方法', /** 方法写反会让新增覆盖已有菜单或修改新建脏数据。 */ async () => {
    await createMenu(menuPayload);
    await updateMenu(menuPayload);

    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/menu/create',
      menuPayload,
    );
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/menu/update',
      menuPayload,
    );
  });

  it('单条与批量删除按不同路径传参', /** 批量删除漏拼编号会删不掉或多删菜单。 */ async () => {
    await deleteMenu(5);
    await deleteMenuList([5, 6]);

    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/menu/delete?id=5',
    );
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/menu/delete-list?ids=5,6',
    );
  });
});

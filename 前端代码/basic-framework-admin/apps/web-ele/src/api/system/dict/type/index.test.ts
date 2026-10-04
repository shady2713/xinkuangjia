/**
 * 字典类型接口（api/system/dict/type）的地址、方法与返回契约回归。
 *
 * 字典类型是字典数据的元数据入口：列表地址写错会让下拉选择拿不到类型，增删改的方法
 * 或路径写错会改动其它资源，批量删除的编号分隔符写错会漏删或多删。用例只替换网络边界，
 * 接口自身的地址拼装、参数透传与返回值透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createDictType,
  deleteDictType,
  deleteDictTypeList,
  exportDictType,
  getDictType,
  getDictTypePage,
  getSimpleDictTypeList,
  updateDictType,
} from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，保留接口自身的地址与参数拼装逻辑。 */ () => ({
    requestClient: {
      delete: vi.fn(),
      download: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  }),
);

/** 构造字段完整的字典类型记录，作为各用例的合法基线。 */
function validDictType() {
  return {
    createTime: new Date('2024-01-01T00:00:00Z'),
    id: 7,
    name: '用户性别',
    remark: '',
    status: 0,
    type: 'system_user_sex',
  };
}

describe('字典类型查询', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('精简列表直接返回接口结果', /** 下拉选择按原样使用精简列表，不能额外加工字段。 */ async () => {
    const list = [{ id: 7, name: '用户性别' }];
    vi.mocked(requestClient.get).mockResolvedValue(list);

    await expect(getSimpleDictTypeList()).resolves.toBe(list);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/dict-type/list-all-simple',
    );
  });

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的记录范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validDictType()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getDictTypePage({ pageNo: 2, pageSize: 50 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith('/system/dict-type/page', {
      params: { pageNo: 2, pageSize: 50 },
    });
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会返回错误的字典类型。 */ async () => {
    const detail = validDictType();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getDictType(7)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/dict-type/get?id=7',
    );
  });
});

describe('字典类型写入', /** 增删改的地址、方法与请求体是后端约定的直接体现。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增字典类型提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据。 */ async () => {
    const payload = validDictType();
    vi.mocked(requestClient.post).mockResolvedValue(7);

    await expect(createDictType(payload)).resolves.toBe(7);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/dict-type/create',
      payload,
    );
  });

  it('修改字典类型使用 PUT', /** 修改与新增共用路径时必须靠方法区分。 */ async () => {
    const payload = validDictType();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateDictType(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/dict-type/update',
      payload,
    );
  });

  it('按编号删除单个字典类型', /** 删除编号必须进入查询串，避免删错记录。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteDictType(7)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/dict-type/delete?id=7',
    );
  });

  it('批量删除用逗号拼接编号', /** 批量删除的分隔符由后端约定，写错会漏删或多删。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteDictTypeList([7, 9])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/dict-type/delete-list?ids=7,9',
    );
  });
});

describe('字典类型导出', /** 导出沿用筛选条件且不接受分页参数。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('导出只透传筛选条件', /** 带分页参数会让导出漏掉未在首页的记录。 */ async () => {
    const file = new Blob(['dict-type']);
    vi.mocked(requestClient.download).mockResolvedValue(file);

    await expect(exportDictType({ name: '用户性别', status: 0 })).resolves.toBe(
      file,
    );
    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/dict-type/export-excel',
      { params: { name: '用户性别', status: 0 } },
    );
  });
});

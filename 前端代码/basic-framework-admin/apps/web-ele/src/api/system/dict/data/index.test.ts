/**
 * 字典数据接口（api/system/dict/data）的地址、方法与返回契约回归。
 *
 * 字典数据既服务于下拉选择也服务于字典数据维护页：地址、HTTP 方法或查询串写错会让
 * 维护页读写到其它字典记录，批量删除的编号分隔符写错会漏删或多删，导出接口误带分页
 * 参数则会漏掉未在首页的记录。用例只替换网络边界，接口自身的地址拼装、参数透传与
 * 返回值透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createDictData,
  deleteDictData,
  deleteDictDataList,
  exportDictData,
  getDictData,
  getDictDataPage,
  getSimpleDictDataList,
  updateDictData,
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

/** 构造字段完整的字典数据记录，作为各用例的合法基线。 */
function validDictData() {
  return {
    colorType: 'success',
    createTime: new Date('2024-01-01T00:00:00Z'),
    cssClass: '',
    dictType: 'system_user_sex',
    id: 3,
    label: '男',
    remark: '',
    sort: 1,
    status: 0,
    value: '1',
  };
}

describe('字典数据查询', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('精简列表直接返回接口结果', /** 下拉选择按原样使用精简列表，不能额外加工字段。 */ async () => {
    const list = [{ label: '男', value: '1' }];
    vi.mocked(requestClient.get).mockResolvedValue(list);

    await expect(getSimpleDictDataList()).resolves.toBe(list);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/dict-data/simple-list',
    );
  });

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的记录范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validDictData()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getDictDataPage({ pageNo: 2, pageSize: 50 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith('/system/dict-data/page', {
      params: { pageNo: 2, pageSize: 50 },
    });
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会返回错误的字典数据。 */ async () => {
    const detail = validDictData();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getDictData(3)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/system/dict-data/get?id=3',
    );
  });
});

describe('字典数据写入', /** 增删改的地址、方法与请求体是后端约定的直接体现。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增字典数据提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据。 */ async () => {
    const payload = validDictData();
    vi.mocked(requestClient.post).mockResolvedValue(3);

    await expect(createDictData(payload)).resolves.toBe(3);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/system/dict-data/create',
      payload,
    );
  });

  it('修改字典数据使用 PUT', /** 修改与新增共用路径时必须靠方法区分。 */ async () => {
    const payload = validDictData();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateDictData(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/system/dict-data/update',
      payload,
    );
  });

  it('按编号删除单条字典数据', /** 删除编号必须进入查询串，避免删错记录。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteDictData(3)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/dict-data/delete?id=3',
    );
  });

  it('批量删除用逗号拼接编号', /** 批量删除的分隔符由后端约定，写错会漏删或多删。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteDictDataList([3, 5, 8])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/system/dict-data/delete-list?ids=3,5,8',
    );
  });
});

describe('字典数据导出', /** 导出沿用筛选条件且不接受分页参数。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('导出只透传筛选条件', /** 带分页参数会让导出漏掉未在首页的记录。 */ async () => {
    const file = new Blob(['dict-data']);
    vi.mocked(requestClient.download).mockResolvedValue(file);

    await expect(exportDictData({ dictType: 'system_user_sex' })).resolves.toBe(
      file,
    );
    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/dict-data/export-excel',
      { params: { dictType: 'system_user_sex' } },
    );
  });
});

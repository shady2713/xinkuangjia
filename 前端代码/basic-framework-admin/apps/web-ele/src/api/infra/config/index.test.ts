/**
 * 参数配置接口（api/infra/config）的地址、方法与参数契约回归。
 *
 * 参数配置是运行时行为的开关来源：分页查询决定列表范围，按键查询会被业务代码
 * 用来读取开关值，增删改与批量删除直接改变线上配置，导出用于留档核对。
 * 地址或方法写错会把配置写到其它资源，按键没拼进查询串会读到错误的配置值，
 * 批量删除编号分隔符写错会漏删或多删。用例只替换网络收发边界，接口自身的
 * 地址拼装与参数透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createConfig,
  deleteConfig,
  deleteConfigList,
  exportConfig,
  getConfig,
  getConfigKey,
  getConfigPage,
  updateConfig,
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

/** 构造字段完整的参数配置记录，作为各用例的合法基线。 */
function validConfig() {
  return {
    category: '演示分类',
    id: 3,
    key: 'demo.switch',
    name: '演示开关',
    remark: '演示用参数',
    type: 1,
    value: 'true',
    visible: true,
  };
}

describe('参数配置查询', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的配置范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validConfig()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getConfigPage({ pageNo: 1, pageSize: 10 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith('/infra/config/page', {
      params: { pageNo: 1, pageSize: 10 },
    });
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会展示并改动另一条配置。 */ async () => {
    const detail = validConfig();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getConfig(3)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith('/infra/config/get?id=3');
  });

  it('按配置键查询值把键名拼进查询串', /** 键名是业务读取开关的唯一依据，写错会静默拿到空值并按缺省逻辑运行。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue('true');

    await expect(getConfigKey('demo.switch')).resolves.toBe('true');
    expect(requestClient.get).toHaveBeenCalledWith(
      '/infra/config/get-value-by-key?key=demo.switch',
    );
  });
});

describe('参数配置写入', /** 增删改与批量删除直接改变线上运行参数，地址与方法必须准确。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增配置使用 POST 提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据，字段漏传会写入不可用配置。 */ async () => {
    const payload = validConfig();
    vi.mocked(requestClient.post).mockResolvedValue(3);

    await expect(createConfig(payload)).resolves.toBe(3);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/infra/config/create',
      payload,
    );
  });

  it('修改配置使用 PUT 提交完整请求体', /** 修改与新增共用路径时必须靠方法区分，误用 POST 会创建重复配置。 */ async () => {
    const payload = validConfig();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateConfig(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/infra/config/update',
      payload,
    );
  });

  it('按编号删除配置', /** 编号必须进入查询串，删错配置会让依赖它的业务开关失效。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteConfig(3)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/infra/config/delete?id=3',
    );
  });

  it('批量删除用逗号拼接编号', /** 分隔符由后端约定，写错会漏删或多删配置。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteConfigList([3, 4])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/infra/config/delete-list?ids=3,4',
    );
  });
});

describe('参数配置导出', /** 导出沿用筛选条件且不接受分页参数，否则下载文件会缺记录。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('导出只透传筛选条件', /** 混入分页参数会让后端只导出当前页，属于静默丢数据。 */ async () => {
    const file = new Blob(['config']);
    vi.mocked(requestClient.download).mockResolvedValue(file);

    await expect(exportConfig({ name: '演示开关' })).resolves.toBe(file);
    expect(requestClient.download).toHaveBeenCalledWith(
      '/infra/config/export-excel',
      { params: { name: '演示开关' } },
    );
  });
});

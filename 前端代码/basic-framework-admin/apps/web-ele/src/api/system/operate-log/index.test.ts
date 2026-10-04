/**
 * 操作日志接口（apps/web-ele 的 api/system/operate-log）真实请求契约回归。
 *
 * 该模块只有分页查询与导出两个入口：地址或参数写错会让日志列表查不到数据、导出文件缺少
 * 筛选结果。用例只替换网络收发边界，断言分页参数原样传递、导出接口不接受分页参数，
 * 并核对返回值与文件流原样透传。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { exportOperateLog, getOperateLogPage } from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，两个接口的参数拼装保持真实实现。 */ () => ({
    requestClient: { download: vi.fn(), get: vi.fn() },
  }),
);

beforeEach(
  /** 每例独立提供响应，不继承上例结果。 */ () => {
    vi.resetAllMocks();
  },
);

describe('操作日志接口', /** 分页查询与导出的请求契约。 */ () => {
  it('分页查询按原样传递分页与筛选参数', /** 参数被丢弃会让日志列表始终显示第一页全量数据。 */ async () => {
    const pageResult = { list: [], total: 0 };
    vi.mocked(requestClient.get).mockResolvedValue(pageResult);
    const params = { pageNo: 3, pageSize: 20, type: '2' };

    const result = await getOperateLogPage(params);

    expect(requestClient.get).toHaveBeenCalledWith('/system/operate-log/page', {
      params,
    });
    expect(result).toBe(pageResult);
  });

  it('导出只传递筛选条件并返回文件流', /** 导出混入分页参数会让导出结果缺行。 */ async () => {
    const stream = new Blob(['DUMMY-excel']);
    vi.mocked(requestClient.download).mockResolvedValue(stream);
    const params = { type: '2' };

    const result = await exportOperateLog(params);

    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/operate-log/export-excel',
      { params },
    );
    expect(result).toBe(stream);
  });
});

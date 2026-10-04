/**
 * 定时任务日志接口（api/infra/job-log）的地址、方法与返回契约回归。
 *
 * 任务日志页只做三件事：分页查询日志、按编号查看单次执行详情、按当前筛选条件导出。
 * 分页参数丢失会让列表退化成默认首页，详情编号没拼进查询串会取到别的执行记录，
 * 导出接口带上分页参数会让下载文件缺记录。用例只替换网络收发边界，接口自身的
 * 地址拼装与参数透传保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { exportJobLog, getJobLog, getJobLogPage } from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，保留接口自身的地址与参数拼装逻辑。 */ () => ({
    requestClient: {
      download: vi.fn(),
      get: vi.fn(),
    },
  }),
);

/** 构造字段完整的任务日志记录，作为各用例的响应基线。 */
function validJobLog() {
  return {
    beginTime: new Date('2026-01-02T03:00:00.000Z'),
    cronExpression: '0 0 * * * ?',
    duration: '120',
    endTime: new Date('2026-01-02T03:00:02.000Z'),
    executeIndex: '1',
    handlerName: 'demoJob',
    handlerParam: '{}',
    id: 42,
    jobId: 7,
    result: '执行成功',
    status: 1,
  };
}

describe('任务日志查询', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的执行记录范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validJobLog()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getJobLogPage({ pageNo: 2, pageSize: 15 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith('/infra/job-log/page', {
      params: { pageNo: 2, pageSize: 15 },
    });
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会返回其它任务或其它批次的执行记录。 */ async () => {
    const detail = validJobLog();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getJobLog(42)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith('/infra/job-log/get?id=42');
  });
});

describe('任务日志导出', /** 导出沿用筛选条件且不接受分页参数，否则下载文件会缺记录。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('导出只透传筛选条件', /** 混入分页参数会让后端只导出当前页，属于静默丢数据。 */ async () => {
    const file = new Blob(['job-log']);
    vi.mocked(requestClient.download).mockResolvedValue(file);

    await expect(exportJobLog({ handlerName: 'demoJob' })).resolves.toBe(file);
    expect(requestClient.download).toHaveBeenCalledWith(
      '/infra/job-log/export-excel',
      { params: { handlerName: 'demoJob' } },
    );
  });
});

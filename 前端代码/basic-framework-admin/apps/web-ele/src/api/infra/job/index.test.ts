/**
 * 定时任务接口（api/infra/job）的地址、方法与返回契约回归。
 *
 * 定时任务维护页同时提供增删改、启停、手动触发和下次执行时间预览：地址或方法写错会把
 * 操作落到其它资源，批量删除的编号分隔符写错会漏删或多删，下次执行时间未校验会让非法
 * 毫秒值进入排期展示。用例只替换网络边界，接口自身的地址拼装、参数透传与校验保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import {
  createJob,
  deleteJob,
  deleteJobList,
  exportJob,
  getJob,
  getJobNextTimes,
  getJobPage,
  runJob,
  updateJob,
  updateJobStatus,
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

/** 构造字段完整的定时任务记录，作为各用例的合法基线。 */
function validJob() {
  return {
    cronExpression: '0 0 0 * * ?',
    handlerName: 'demoJob',
    handlerParam: '',
    id: 11,
    monitorTimeout: 0,
    name: '演示任务',
    retryCount: 3,
    retryInterval: 5,
    status: 0,
  };
}

describe('定时任务查询', /** 查询地址、查询串与返回值必须与后端约定一致。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('分页查询把分页参数原样透传', /** 分页参数决定返回的记录范围，丢失会退化成默认首页。 */ async () => {
    const page = { list: [validJob()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getJobPage({ pageNo: 3, pageSize: 20 })).resolves.toBe(page);
    expect(requestClient.get).toHaveBeenCalledWith('/infra/job/page', {
      params: { pageNo: 3, pageSize: 20 },
    });
  });

  it('按编号查询详情把编号拼进查询串', /** 编号必须进入查询串，否则会返回错误的定时任务。 */ async () => {
    const detail = validJob();
    vi.mocked(requestClient.get).mockResolvedValue(detail);

    await expect(getJob(11)).resolves.toBe(detail);
    expect(requestClient.get).toHaveBeenCalledWith('/infra/job/get?id=11');
  });

  it('下次执行时间必须是非空毫秒整数数组', /** 字符串时间或非安全整数会让排期展示与实际执行不一致。 */ async () => {
    vi.mocked(requestClient.get).mockResolvedValue([1_900_000_000_000, 0]);

    await expect(getJobNextTimes(11)).resolves.toEqual([1_900_000_000_000, 0]);
    expect(requestClient.get).toHaveBeenCalledWith(
      '/infra/job/get_next_times?id=11',
    );

    vi.mocked(requestClient.get).mockResolvedValue('1900000000000');
    await expect(getJobNextTimes(11)).rejects.toThrow('后续执行时间必须是数组');

    vi.mocked(requestClient.get).mockResolvedValue([1.5]);
    await expect(getJobNextTimes(11)).rejects.toThrow('执行时间必须是毫秒整数');
  });
});

describe('定时任务写入', /** 增删改、启停与手动触发的地址和方法是后端约定的直接体现。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('新增定时任务提交完整请求体', /** 新增必须使用 POST 并原样提交表单数据。 */ async () => {
    const payload = validJob();
    vi.mocked(requestClient.post).mockResolvedValue(11);

    await expect(createJob(payload)).resolves.toBe(11);
    expect(requestClient.post).toHaveBeenCalledWith(
      '/infra/job/create',
      payload,
    );
  });

  it('修改定时任务使用 PUT', /** 修改与新增共用路径时必须靠方法区分。 */ async () => {
    const payload = validJob();
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateJob(payload)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/infra/job/update',
      payload,
    );
  });

  it('按编号删除单个定时任务', /** 删除编号必须进入查询串，避免删错任务。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteJob(11)).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/infra/job/delete?id=11',
    );
  });

  it('批量删除用逗号拼接编号', /** 批量删除的分隔符由后端约定，写错会漏删或多删。 */ async () => {
    vi.mocked(requestClient.delete).mockResolvedValue(true);

    await expect(deleteJobList([11, 12])).resolves.toBe(true);
    expect(requestClient.delete).toHaveBeenCalledWith(
      '/infra/job/delete-list?ids=11,12',
    );
  });

  it('启用状态通过查询串提交且不发送请求体', /** 状态必须作为查询参数，放进请求体会被后端忽略。 */ async () => {
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(updateJobStatus(11, 1)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith(
      '/infra/job/update-status',
      undefined,
      { params: { id: 11, status: 1 } },
    );
  });

  it('手动触发只携带任务编号', /** 触发接口按编号定位任务，多带参数会偏离后端契约。 */ async () => {
    vi.mocked(requestClient.put).mockResolvedValue(true);

    await expect(runJob(11)).resolves.toBe(true);
    expect(requestClient.put).toHaveBeenCalledWith('/infra/job/trigger?id=11');
  });
});

describe('定时任务导出', /** 导出沿用筛选条件且不接受分页参数。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('导出只透传筛选条件', /** 带分页参数会让导出漏掉未在首页的记录。 */ async () => {
    const file = new Blob(['job']);
    vi.mocked(requestClient.download).mockResolvedValue(file);

    await expect(exportJob({ name: '演示任务' })).resolves.toBe(file);
    expect(requestClient.download).toHaveBeenCalledWith(
      '/infra/job/export-excel',
      { params: { name: '演示任务' } },
    );
  });
});

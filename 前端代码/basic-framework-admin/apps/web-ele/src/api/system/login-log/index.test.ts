/**
 * 登录日志接口（api/system/login-log）的地址与参数契约回归。
 *
 * 登录日志页只做分页查询与按条件导出：分页参数丢失会让列表退化成后端默认首页，
 * 导出接口的筛选条件丢失会让用户下载到与页面不一致的数据。用例只替换网络收发
 * 边界，接口自身的地址拼装、参数透传与结果返回保持真实实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestClient } from '#/api/request';

import { exportLoginLog, getLoginLogPage } from './index';

vi.mock(
  '#/api/request',
  /** 只替换网络收发边界，保留接口自身的地址与参数拼装逻辑。 */ () => ({
    requestClient: {
      download: vi.fn(),
      get: vi.fn(),
    },
  }),
);

/** 构造字段完整的登录日志记录，作为分页结果的合法基线。 */
function loginLogRecord() {
  return {
    createTime: '2026-01-02 03:04:05',
    id: 9,
    logType: 1,
    result: 0,
    status: 0,
    traceId: 77,
    userAgent: 'Mozilla/5.0',
    userId: 3,
    userIp: '127.0.0.1',
    username: 'admin',
    userType: 1,
  };
}

describe('登录日志分页查询', /** 分页参数与地址是后端约定的直接体现，写错会让列表读到错误范围。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('把分页参数原样透传到分页地址', /** 分页参数丢失会让列表退化成后端默认首页。 */ async () => {
    const page = { list: [loginLogRecord()], total: 1 };
    vi.mocked(requestClient.get).mockResolvedValue(page);

    await expect(getLoginLogPage({ pageNo: 2, pageSize: 20 })).resolves.toBe(
      page,
    );
    expect(requestClient.get).toHaveBeenCalledWith('/system/login-log/page', {
      params: { pageNo: 2, pageSize: 20 },
    });
  });

  it('查询失败时向调用方传播原始错误', /** 请求层错误被吞掉会让页面把失败显示成空列表。 */ async () => {
    const failure = new Error('登录日志查询失败');
    vi.mocked(requestClient.get).mockRejectedValue(failure);

    await expect(getLoginLogPage({ pageNo: 1, pageSize: 10 })).rejects.toBe(
      failure,
    );
  });
});

describe('登录日志导出', /** 导出沿用页面筛选条件且不接受分页参数，混入分页会让导出只覆盖当前页。 */ () => {
  beforeEach(
    /** 每例独立提供响应，避免请求记录相互干扰。 */ () => {
      vi.resetAllMocks();
    },
  );

  it('把筛选条件交给导出接口并原样返回文件流', /** 下载地址或参数结构变化会让用户拿到空文件或错误文件。 */ async () => {
    const file = new Blob(['DUMMY-login-log-export']);
    vi.mocked(requestClient.download).mockResolvedValue(file);

    await expect(
      exportLoginLog({
        createTime: ['2026-01-01', '2026-01-31'],
        username: 'admin',
      }),
    ).resolves.toBe(file);
    expect(requestClient.download).toHaveBeenCalledWith(
      '/system/login-log/export-excel',
      {
        params: { createTime: ['2026-01-01', '2026-01-31'], username: 'admin' },
      },
    );
  });

  it('导出失败时向调用方传播原始错误', /** 失败必须让调用方停止下载动作，而不是触发一次空文件下载。 */ async () => {
    const failure = new Error('登录日志导出失败');
    vi.mocked(requestClient.download).mockRejectedValue(failure);

    await expect(exportLoginLog({ username: 'admin' })).rejects.toBe(failure);
  });
});

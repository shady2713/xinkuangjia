/**
 * 请求拦截器 HTTP 200 JSON-Blob 错误解包回归测试。
 *
 * @author shady2713
 */
import type { RequestResponse } from '@vben/request';

import { describe, expect, it } from 'vitest';

import { resolveErrorMessage, unwrapJsonErrorBlobResponse } from '../request';

describe('unwrapJsonErrorBlobResponse', () => {
  it('拦截 HTTP 200 JSON 业务错误 Blob 并保留 config 与 response', async () => {
    const mockConfig = { url: '/system/user/export-excel' };
    const blob = new Blob([JSON.stringify({ code: 401, msg: '令牌已过期' })], {
      type: 'application/json;charset=UTF-8',
    });
    const response = {
      config: mockConfig,
      data: blob,
      headers: {},
      status: 200,
    } as unknown as RequestResponse;

    await expect(unwrapJsonErrorBlobResponse(response)).rejects.toMatchObject({
      config: mockConfig,
      data: { code: 401, msg: '令牌已过期' },
      message: '令牌已过期',
      response,
    });
  });

  it('普通二进制 Excel Blob 原样放行不被改写', async () => {
    const excelBlob = new Blob(['PK\u0003\u0004'], {
      type: 'application/vnd.ms-excel',
    });
    const response = {
      config: { url: '/system/user/export-excel' },
      data: excelBlob,
      headers: {},
      status: 200,
    } as unknown as RequestResponse;

    const result = await unwrapJsonErrorBlobResponse(response);
    expect(result.data).toBe(excelBlob);
  });
});

/** 验证 resolveErrorMessage 提取非标准响应体、自定义 Error 与通用 Axios 状态兜底文案。 */
describe('resolveErrorMessage', () => {
  it('优先提取 error.msg 与非通用 Error.message，通用状态码文案回退本地兜底', () => {
    expect(
      resolveErrorMessage('默认错误', { code: 400, msg: '无效的刷新令牌' }),
    ).toBe('无效的刷新令牌');
    expect(
      resolveErrorMessage('默认错误', new Error('响应数据解密失败: bad key')),
    ).toBe('响应数据解密失败: bad key');
    expect(
      resolveErrorMessage('服务器内部错误', {
        message: 'Request failed with status code 500',
        response: { status: 500 },
      }),
    ).toBe('服务器内部错误');
  });
});

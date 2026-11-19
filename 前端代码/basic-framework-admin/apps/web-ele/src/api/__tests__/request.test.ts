/**
 * 请求拦截器 HTTP 200 JSON-Blob 错误解包回归测试。
 *
 * @author shady2713
 */
import type { RequestResponse } from '@vben/request';

import { describe, expect, it } from 'vitest';

import { unwrapJsonErrorBlobResponse } from '../request';

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

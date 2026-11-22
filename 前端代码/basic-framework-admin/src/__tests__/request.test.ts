import type { AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { resolveErrorMessage, unwrapBlobJsonError } from '@/api/request';

describe('request error helpers', () => {
  it('unwraps JSON business error returned inside a Blob download response', async () => {
    const payload = JSON.stringify({ code: 403, data: null, msg: '无导出权限' });
    const resp = {
      data: new Blob([payload], { type: 'application/json' }),
      headers: { 'content-type': 'application/json;charset=UTF-8' },
    } as unknown as AxiosResponse;

    const err = await unwrapBlobJsonError(resp);
    expect(err).toEqual({ code: 403, data: null, msg: '无导出权限' });
  });

  it('returns null for normal binary Excel blobs', async () => {
    const resp = {
      data: new Blob(['PK\x03\x04binary'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      headers: { 'content-type': 'application/octet-stream' },
    } as unknown as AxiosResponse;

    expect(await unwrapBlobJsonError(resp)).toBeNull();
  });

  it('resolves user-facing error messages from server response or network error', () => {
    expect(
      resolveErrorMessage({ response: { data: { msg: '账号已锁定' } } }),
    ).toBe('账号已锁定');
    expect(resolveErrorMessage({ message: 'timeout of 30000ms exceeded' })).toBe(
      '请求超时，请稍后重试',
    );
    expect(resolveErrorMessage({ message: 'Network Error' })).toBe(
      '网络连接异常，请检查后端服务',
    );
  });
});

/** 传输层边界校验测试：验证响应外壳判定与失败请求的会话代次读取口径。 */
import { AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import {
  getErrorResponse,
  getErrorSession,
  isRecord,
  requireResponse,
} from './response';

/** 构造满足响应外壳校验的最小传输配置。
 * @param overrides 需要覆盖的 Axios 配置字段。
 * @returns 含 AxiosHeaders 的内部请求配置。
 */
function config(overrides: Record<string, unknown> = {}) {
  return {
    headers: new AxiosHeaders(),
    url: 'https://example.test/events',
    ...overrides,
  };
}

/** 构造满足响应外壳校验的最小响应。
 * @param overrides 需要覆盖的响应字段或配置。
 * @returns 可作为 RequestResponse 使用的响应对象。
 */
function response(overrides: Record<string, unknown> = {}) {
  return {
    config: config(),
    data: { id: 1 },
    headers: new AxiosHeaders(),
    status: 200,
    statusText: 'OK',
    ...overrides,
  };
}

describe('isRecord', /** 后续所有字段读取都依赖该判定，数组与 null 不能当成对象。 */ () => {
  it.each([
    ['普通对象', { a: 1 }, true],
    ['null', null, false],
    ['数组', [], false],
    ['字符串', 'value', false],
    ['undefined', undefined, false],
  ])(
    '判定%s',
    /** 只有可安全按字符串键读取的值才算记录。 */ (_name, value, expected) => {
      expect(isRecord(value)).toBe(expected);
    },
  );
});

describe('requireResponse', /** 拦截器必须拿到完整 HTTP 外壳，已被解包的响应要立即失败。 */ () => {
  it('接受完整响应外壳', /** 正常传输结果不能被误拒绝。 */ () => {
    const value = response();

    expect(requireResponse(value)).toBe(value);
  });

  it.each([
    ['业务数据节点', { id: 1 }],
    ['缺少配置的响应', { data: {}, headers: {}, status: 200 }],
    ['配置头不是 AxiosHeaders', response({ config: { headers: {} } })],
    ['状态不是数字', response({ status: '200' })],
    ['状态描述不是字符串', response({ statusText: 200 })],
    ['响应头不是对象', response({ headers: null })],
    [
      '会话代次不是安全整数',
      response({ config: config({ sessionEpoch: 1.5 }) }),
    ],
    [
      '重试标记不是布尔值',
      response({ config: config({ __isRetryRequest: 'yes' }) }),
    ],
    [
      '响应模式取值非法',
      response({ config: config({ responseReturn: 'file' }) }),
    ],
  ])(
    '拒绝%s',
    /** 前半段处理链若已解包或写坏外壳，后续拦截器不能继续按响应读取。 */ (
      _name,
      value,
    ) => {
      expect(
        /** 触发外壳校验失败。 */
        () => requireResponse(value),
      ).toThrow('响应处理器需要完整 HTTP 响应');
    },
  );
});

describe('getErrorResponse', /** 只有挂在异常上的有效响应才可读取，普通异常没有响应。 */ () => {
  it('从错误对象中取出响应外壳', /** 错误提示与状态码分支都依赖该响应。 */ () => {
    const value = response({ status: 403 });

    expect(getErrorResponse({ response: value })).toBe(value);
  });

  it.each([
    ['普通异常', new Error('offline')],
    ['没有 response 字段', { message: 'failed' }],
    ['response 不是对象', { response: 'invalid' }],
    ['response 外壳不完整', { response: { status: 403 } }],
  ])(
    '对%s返回 undefined',
    /** 无有效响应的失败必须由调用方按传输错误处理。 */ (_name, error) => {
      expect(getErrorResponse(error)).toBeUndefined();
    },
  );
});

describe('getErrorSession', /** 会话代次决定迟到失败是否属于当前身份，非法值不能当成有效代次。 */ () => {
  it('读取已通过校验的请求代次', /** 拦截器需要用它判断是否仍属于发起身份。 */ () => {
    expect(getErrorSession({ config: config({ sessionEpoch: 8 }) })).toBe(8);
  });

  it.each([
    ['非对象异常', 'boom'],
    ['缺少配置的异常', { message: 'failed' }],
    ['配置不是对象', { config: 'invalid' }],
    ['缺少代次字段', { config: config() }],
    ['代次是字符串', { config: config({ sessionEpoch: '8' }) }],
    [
      '代次超出安全整数',
      { config: config({ sessionEpoch: Number.MAX_SAFE_INTEGER + 1 }) },
    ],
  ])(
    '对%s返回 undefined',
    /** 无有效代次时调用方不得按当前会话处理该失败。 */ (_name, error) => {
      expect(getErrorSession(error)).toBeUndefined();
    },
  );
});

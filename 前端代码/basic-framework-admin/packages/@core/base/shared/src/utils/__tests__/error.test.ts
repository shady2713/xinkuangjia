/** 错误信息提取与分级日志的测试：覆盖多种后端错误形状下的消息来源优先级与元数据拼装。 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getErrorMessage, logError, logWarn } from '../error';

/** 静默指定级别的控制台输出，只保留可断言的调用记录。
 * @param method 要拦截的控制台方法。
 * @returns 拦截后的 Spy，可直接断言调用参数。
 */
function silenceConsole(method: 'error' | 'warn') {
  return vi
    .spyOn(console, method)
    .mockImplementation(/** 不真正打印日志，只让 Spy 记录调用。 */ () => {});
}

afterEach(
  /** 恢复真实控制台，避免本文件的断言 Spy 影响其它用例。 */ () => {
    vi.restoreAllMocks();
  },
);

describe('getErrorMessage', /** 消息来源有优先级：字符串、Error、错误体 message、响应体字段、兜底文案。 */ () => {
  it('字符串错误原样返回', /** 调用方直接抛出字符串时不能被二次包装。 */ () => {
    expect(getErrorMessage('接口超时')).toBe('接口超时');
  });

  it('error 实例取 message', /** 抛出的 Error 自身描述优先于任何兜底。 */ () => {
    expect(getErrorMessage(new Error('余额不足'))).toBe('余额不足');
  });

  it('无 message 的 Error 继续向下取值', /** 空的 Error.message 不能当成有效消息。 */ () => {
    /** 模拟只设置了错误类型、没有设置描述的 Error。 */
    const error = new Error('占位');
    error.message = '';

    expect(getErrorMessage(error)).toBe('Unknown error');
  });

  it('普通对象的 message 字段优先', /** 拦截器构造的普通错误对象要能取出消息。 */ () => {
    expect(getErrorMessage({ message: '参数缺失' })).toBe('参数缺失');
  });

  it('响应体 error 字段', /** 本项目后端统一把业务错误放在 error 字段。 */ () => {
    expect(
      getErrorMessage({ response: { data: { error: '用户不存在' } } }),
    ).toBe('用户不存在');
  });

  it('响应体 message 字段', /** 兼容返回 message 的网关。 */ () => {
    expect(
      getErrorMessage({ response: { data: { message: '网关拒绝' } } }),
    ).toBe('网关拒绝');
  });

  it('响应体 msg 字段', /** 兼容旧接口的 msg 字段。 */ () => {
    expect(getErrorMessage({ response: { data: { msg: '旧版提示' } } })).toBe(
      '旧版提示',
    );
  });

  it('响应体没有可识别字段时使用兜底', /** 不能返回 undefined 让界面显示空白。 */ () => {
    expect(getErrorMessage({ response: { data: { code: 500 } } })).toBe(
      'Unknown error',
    );
  });

  it('非对象入参按无信息处理', /** 数字、布尔等入参没有可提取字段，只能走兜底。 */ () => {
    expect(getErrorMessage(42)).toBe('Unknown error');
    expect(getErrorMessage(false)).toBe('Unknown error');
  });

  it('自定义兜底文案', /** 调用方可以为不同场景指定更贴近业务的提示。 */ () => {
    expect(getErrorMessage({}, '网络异常')).toBe('网络异常');
  });
});

describe('logError 与 logWarn', /** 日志按级别输出，并把可定位的业务元数据拼在同一条消息里。 */ () => {
  it('error 级别写 console.error 并附元数据', /** 日志必须带 HTTP 状态码才能定位失败请求。 */ () => {
    const error = silenceConsole('error');

    logError('api', {
      message: '请求失败',
      name: 'BizError',
      response: { status: 502 },
    });

    expect(error).toHaveBeenCalledWith(
      '[api] 请求失败 {"name":"BizError","status":502}',
    );
  });

  it('字符串 code 也进入元数据', /** 部分网关用字符串错误码，仍需可检索。 */ () => {
    const error = silenceConsole('error');

    logError('api', { code: 'E1001', message: '签名错误' });

    expect(error).toHaveBeenCalledWith('[api] 签名错误 {"code":"E1001"}');
  });

  it('数字 code 与顶层 status 优先', /** 顶层 status 优先于 response.status。 */ () => {
    const error = silenceConsole('error');

    logError('api', {
      code: 500,
      message: '服务异常',
      response: { status: 502 },
      status: 500,
    });

    expect(error).toHaveBeenCalledWith(
      '[api] 服务异常 {"code":500,"status":500}',
    );
  });

  it('响应体状态码在顶层缺失时生效', /** 没有顶层 status 时回退到 response.status。 */ () => {
    const error = silenceConsole('error');

    logError('api', { message: '服务异常', response: { status: 503 } });

    expect(error).toHaveBeenCalledWith('[api] 服务异常 {"status":503}');
  });

  it('没有可提取元数据时不追加 JSON 片段', /** 避免日志出现空对象噪声。 */ () => {
    const error = silenceConsole('error');

    logError('api', { message: '仅有消息' });

    expect(error).toHaveBeenCalledWith('[api] 仅有消息');
  });

  it('错误为空时只输出作用域', /** 没有错误对象时不能伪造一条异常记录。 */ () => {
    const error = silenceConsole('error');

    logError('api');
    logError('api', null);

    expect(error).toHaveBeenNthCalledWith(1, '[api]');
    expect(error).toHaveBeenNthCalledWith(2, '[api]');
  });

  it('warn 级别写 console.warn 而非 error', /** 可预期的问题不应污染 error 告警。 */ () => {
    const warn = silenceConsole('warn');
    const error = silenceConsole('error');

    logWarn('cache', { message: '缓存未命中', name: 'CacheMiss' });

    expect(warn).toHaveBeenCalledWith(
      '[cache] 缓存未命中 {"name":"CacheMiss"}',
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('warn 级别在错误为空时同样只输出作用域', /** 与 error 级别保持一致的空值处理。 */ () => {
    const warn = silenceConsole('warn');

    logWarn('cache');

    expect(warn).toHaveBeenCalledWith('[cache]');
  });
});

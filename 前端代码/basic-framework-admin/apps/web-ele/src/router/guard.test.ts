/**
 * 验证路由守卫站内重定向清洗逻辑，阻断开放重定向与畸形编码崩溃。
 *
 * @author shady2713
 */
import { describe, expect, it } from 'vitest';

import { resolveSafeInternalRedirect } from './guard';

const DEFAULT_HOME = '/dashboard';

/** 验证合法的站内单斜杠路径和百分号编码站内路径原样解析。 */
function allowsSafeInternalPaths() {
  expect(
    resolveSafeInternalRedirect('/system/user?pageNo=2', DEFAULT_HOME),
  ).toBe('/system/user?pageNo=2');
  expect(
    resolveSafeInternalRedirect(
      encodeURIComponent('/infra/job?status=0'),
      DEFAULT_HOME,
    ),
  ).toBe('/infra/job?status=0');
}

/** 验证外部绝对地址、协议相对地址、反斜杠混淆、换行符及畸形百分号编码均回退至默认首页。 */
function blocksOpenRedirectAndMalformedPayloads() {
  expect(
    resolveSafeInternalRedirect('https://evil.example.com/login', DEFAULT_HOME),
  ).toBe(DEFAULT_HOME);
  expect(
    resolveSafeInternalRedirect('//evil.example.com/phish', DEFAULT_HOME),
  ).toBe(DEFAULT_HOME);
  expect(
    resolveSafeInternalRedirect(
      encodeURIComponent('//evil.example.com/phish'),
      DEFAULT_HOME,
    ),
  ).toBe(DEFAULT_HOME);
  expect(
    resolveSafeInternalRedirect(String.raw`/\evil.example.com`, DEFAULT_HOME),
  ).toBe(DEFAULT_HOME);
  expect(
    resolveSafeInternalRedirect('/system\r\n/injected', DEFAULT_HOME),
  ).toBe(DEFAULT_HOME);
  expect(resolveSafeInternalRedirect('%E0%A4%A', DEFAULT_HOME)).toBe(
    DEFAULT_HOME,
  );
  expect(resolveSafeInternalRedirect('', DEFAULT_HOME)).toBe(DEFAULT_HOME);
  expect(resolveSafeInternalRedirect(undefined, DEFAULT_HOME)).toBe(
    DEFAULT_HOME,
  );
}

/** 站内重定向安全校验测试套件。 */
function safeRedirectSuite() {
  it('允许单斜杠站内路径与合法编码路径', allowsSafeInternalPaths);
  it(
    '拦截外部域名、协议相对路径、反斜杠与畸形 URI 编码',
    blocksOpenRedirectAndMalformedPayloads,
  );
}

describe('resolveSafeInternalRedirect', safeRedirectSuite);

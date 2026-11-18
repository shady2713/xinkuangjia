/**
 * 验证窗口导航安全校验与 openWindow 属性封装。
 *
 * @author shady2713
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSafeNavigationUrl, openWindow } from '../window';

let originalOpen: typeof window.open;

/** 保存原始 window.open 引用。 */
function saveWindowOpen() {
  originalOpen = window.open;
}

/** 恢复原始 window.open 引用。 */
function restoreWindowOpen() {
  window.open = originalOpen;
}

/** 验证安全 HTTP(S) 链接按默认 noopener/noreferrer 打开。 */
function opensHttpsUrlSafely() {
  const url = 'https://example.com';
  const options = { noopener: true, noreferrer: true, target: '_blank' };

  window.open = vi.fn();
  openWindow(url, options);

  expect(window.open).toHaveBeenCalledWith(
    url,
    options.target,
    'noopener=yes,noreferrer=yes',
  );
}

/** 验证危险伪协议和双斜杠协议相对地址被拦截且不触发 window.open。 */
function blocksUnsafeNavigationSchemes() {
  window.open = vi.fn();

  expect(isSafeNavigationUrl('javascript:alert(1)')).toBe(false);
  expect(isSafeNavigationUrl('data:text/html,<script>alert(1)</script>')).toBe(
    false,
  );
  expect(isSafeNavigationUrl('//evil.example.com/phish')).toBe(false);
  expect(isSafeNavigationUrl('   ')).toBe(false);
  expect(isSafeNavigationUrl('/infra/file/download')).toBe(true);

  openWindow('javascript:alert(1)');
  openWindow('data:text/html,<h1>x</h1>');
  openWindow('//evil.example.com');

  expect(window.open).not.toHaveBeenCalled();
}

/** openWindow 与导航协议安全测试套件。 */
function openWindowSuite() {
  beforeEach(saveWindowOpen);
  afterEach(restoreWindowOpen);

  it('should call window.open with correct arguments', opensHttpsUrlSafely);
  it(
    'blocks javascript:, data:, and protocol-relative URLs',
    blocksUnsafeNavigationSchemes,
  );
}

describe('openWindow', openWindowSuite);

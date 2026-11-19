/**
 * 验证窗口导航安全校验与 openWindow 属性封装。
 *
 * @author shady2713
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isSafeNavigationUrl,
  openRouteInNewWindow,
  openWindow,
} from '../window';

let originalOpen: typeof window.open;
let originalPathname = '/';
let originalHash = '';

/** 保存原始 window.open 与当前页面路径状态。 */
function saveWindowState() {
  originalOpen = window.open;
  originalPathname = location.pathname;
  originalHash = location.hash;
}

/** 恢复原始 window.open 与页面路径状态。 */
function restoreWindowState() {
  window.open = originalOpen;
  window.history.replaceState(null, '', `${originalPathname}${originalHash}`);
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

/** 验证安全 HTTP(S) 链接、单斜杠路径及 openRouteInNewWindow 部署前缀拼接规则。 */
function opensRouteInNewWindowAcrossModes() {
  window.open = vi.fn();

  // 根路径 Hash 模式
  window.history.replaceState(null, '', '/#/dashboard');
  openRouteInNewWindow('/system/user');
  openRouteInNewWindow('#/system/role');
  expect(window.open).toHaveBeenNthCalledWith(
    1,
    `${location.origin}/#/system/user`,
    '_blank',
    'noopener=yes,noreferrer=yes',
  );
  expect(window.open).toHaveBeenNthCalledWith(
    2,
    `${location.origin}/#/system/role`,
    '_blank',
    'noopener=yes,noreferrer=yes',
  );

  // 子路径 /admin/ Hash 模式（涵盖裸路由、#/ 前缀与 router.resolve 完整 href）
  window.history.replaceState(null, '', '/admin/#/dashboard');
  openRouteInNewWindow('/system/user');
  openRouteInNewWindow('#/system/role');
  openRouteInNewWindow('/admin/#/infra/job');
  expect(window.open).toHaveBeenNthCalledWith(
    3,
    `${location.origin}/admin/#/system/user`,
    '_blank',
    'noopener=yes,noreferrer=yes',
  );
  expect(window.open).toHaveBeenNthCalledWith(
    4,
    `${location.origin}/admin/#/system/role`,
    '_blank',
    'noopener=yes,noreferrer=yes',
  );
  expect(window.open).toHaveBeenNthCalledWith(
    5,
    `${location.origin}/admin/#/infra/job`,
    '_blank',
    'noopener=yes,noreferrer=yes',
  );

  // History 模式
  window.history.replaceState(null, '', '/admin/dashboard');
  openRouteInNewWindow('/admin/system/user');
  expect(window.open).toHaveBeenNthCalledWith(
    6,
    `${location.origin}/admin/system/user`,
    '_blank',
    'noopener=yes,noreferrer=yes',
  );
}

/** openWindow 与导航协议安全测试套件。 */
function openWindowSuite() {
  beforeEach(saveWindowState);
  afterEach(restoreWindowState);

  it('should call window.open with correct arguments', opensHttpsUrlSafely);
  it(
    'blocks javascript:, data:, and protocol-relative URLs',
    blocksUnsafeNavigationSchemes,
  );
  it(
    'preserves deployment base prefix when opening routes in new window',
    opensRouteInNewWindowAcrossModes,
  );
}

describe('openWindow', openWindowSuite);

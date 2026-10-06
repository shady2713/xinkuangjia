/**
 * 锁定 window 模块：window.open 的实参组合与站内地址拼接。
 * 覆盖默认 noopener/noreferrer 特性串与关闭时的空串，
 * 以及 hash 模式下站内路由的 origin 拼接。
 * 全部通过替身观察，不校验真实弹窗行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openRouteInNewWindow, openWindow } from '../window';

describe('openWindow', /** 新窗口打开的默认特性串与两个开关的组合。 */ () => {
  // 保存原始的 window.open 函数
  let originalOpen: typeof window.open;

  beforeEach(() => {
    originalOpen = window.open;
  });

  afterEach(() => {
    window.open = originalOpen;
  });

  it('should call window.open with correct arguments', () => {
    const url = 'https://example.com';
    const options = { noopener: true, noreferrer: true, target: '_blank' };

    window.open = vi.fn();

    // 调用函数
    openWindow(url, options);

    // 验证 window.open 是否被正确地调用
    expect(window.open).toHaveBeenCalledWith(
      url,
      options.target,
      'noopener=yes,noreferrer=yes',
    );
  });

  it('should omit the feature string when both flags are off', /** 两个开关都关闭时不传特性串，避免多余参数。 */ () => {
    window.open = vi.fn();

    openWindow('https://example.com', {
      noopener: false,
      noreferrer: false,
      target: '_self',
    });

    expect(window.open).toHaveBeenCalledWith(
      'https://example.com',
      '_self',
      '',
    );
  });

  it('should keep only the enabled flag', /** 只关闭其中一个时特性串里只保留另一个。 */ () => {
    window.open = vi.fn();

    openWindow('https://example.com', { noopener: false });

    expect(window.open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noreferrer=yes',
    );
  });
});

describe('openRouteInNewWindow', /** 在新窗口打开站内路由，需要按当前地址是否使用 hash 决定拼接方式。 */ () => {
  let originalOpen: typeof window.open;

  beforeEach(
    /** 每例替换 window.open，避免真的弹出窗口。 */ () => {
      originalOpen = window.open;
      window.open = vi.fn();
    },
  );

  afterEach(
    /** 交还真实 window.open 与地址访问器。 */ () => {
      window.open = originalOpen;
      vi.restoreAllMocks();
    },
  );

  it('appends the hash prefix when the current page uses hash routing', /** hash 模式下新窗口必须带上 /#/ 才能命中前端路由。 */ () => {
    vi.spyOn(location, 'hash', 'get').mockReturnValue('#/dashboard');
    vi.spyOn(location, 'origin', 'get').mockReturnValue('https://admin.test');

    openRouteInNewWindow('/system/user');

    expect(window.open).toHaveBeenCalledWith(
      'https://admin.test/#/system/user',
      '_blank',
      'noopener=yes,noreferrer=yes',
    );
  });

  it('keeps the plain path when the current page has no hash', /** 非 hash 模式不需要插入 /#。 */ () => {
    vi.spyOn(location, 'hash', 'get').mockReturnValue('');
    vi.spyOn(location, 'origin', 'get').mockReturnValue('https://admin.test');

    openRouteInNewWindow('/system/user');

    expect(window.open).toHaveBeenCalledWith(
      'https://admin.test/system/user',
      '_blank',
      'noopener=yes,noreferrer=yes',
    );
  });

  it('does not repeat the hash prefix when the path already carries it', /** 已带 /# 的路径不能被拼成 /#/#/。 */ () => {
    vi.spyOn(location, 'hash', 'get').mockReturnValue('#/dashboard');
    vi.spyOn(location, 'origin', 'get').mockReturnValue('https://admin.test');

    openRouteInNewWindow('/#/system/user');

    expect(window.open).toHaveBeenCalledWith(
      'https://admin.test/#/system/user',
      '_blank',
      'noopener=yes,noreferrer=yes',
    );
  });

  it('normalizes a path without a leading slash', /** 相对路径也要拼成绝对路径。 */ () => {
    vi.spyOn(location, 'hash', 'get').mockReturnValue('');
    vi.spyOn(location, 'origin', 'get').mockReturnValue('https://admin.test');

    openRouteInNewWindow('system/user');

    expect(window.open).toHaveBeenCalledWith(
      'https://admin.test/system/user',
      '_blank',
      'noopener=yes,noreferrer=yes',
    );
  });
});

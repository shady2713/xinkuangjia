/** 值判别工具的测试：覆盖空值、数字、操作系统与 window 的判定边界。 */
import { describe, expect, it, vi } from 'vitest';

import {
  getFirstNonNullOrUndefined,
  isBoolean,
  isEmpty,
  isHttpUrl,
  isMacOs,
  isNumber,
  isObject,
  isUndefined,
  isWindow,
  isWindowsOs,
} from '../inference';

describe('isHttpUrl', /** HTTP/HTTPS 地址识别，空值与其他协议均不通过。 */ () => {
  it("should return true when given 'http://example.com'", () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
  });

  it("should return true when given 'https://example.com'", () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
  });

  it("should return false when given 'ftp://example.com'", () => {
    expect(isHttpUrl('ftp://example.com')).toBe(false);
  });

  it("should return false when given 'example.com'", /** 没有 HTTP 协议的域名不能作为完整地址。 */ () => {
    expect(isHttpUrl('example.com')).toBe(false);
  });

  it('should return false for a missing url', /** 空值不是合法地址。 */ () => {
    expect(isHttpUrl()).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('isUndefined', () => {
  it('isUndefined should return true for undefined values', () => {
    expect(isUndefined()).toBe(true);
  });

  it('isUndefined should return false for null values', () => {
    expect(isUndefined(null)).toBe(false);
  });

  it('isUndefined should return false for defined values', () => {
    expect(isUndefined(0)).toBe(false);
    expect(isUndefined('')).toBe(false);
    expect(isUndefined(false)).toBe(false);
  });

  it('isUndefined should return false for objects and arrays', () => {
    expect(isUndefined({})).toBe(false);
    expect(isUndefined([])).toBe(false);
  });
});

describe('isEmpty', /** 空值判定覆盖 null、字符串、数组、Map、Set 与普通对象。 */ () => {
  it('should return true for empty string', () => {
    expect(isEmpty('')).toBe(true);
  });

  it('should return true for empty array', () => {
    expect(isEmpty([])).toBe(true);
  });

  it('should return true for empty object', () => {
    expect(isEmpty({})).toBe(true);
  });

  it('should return false for non-empty string', () => {
    expect(isEmpty('hello')).toBe(false);
  });

  it('should return false for non-empty array', () => {
    expect(isEmpty([1, 2, 3])).toBe(false);
  });

  it('should return false for non-empty object', () => {
    expect(isEmpty({ a: 1 })).toBe(false);
  });

  it('should return true for null or undefined', () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty()).toBe(true);
  });

  it('should return false for number or boolean', /** 零和布尔值是实际值，不能视为内容为空。 */ () => {
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty(true)).toBe(false);
  });

  it('should return true for empty Map and Set', /** 空的 Map/Set 没有元素，与空数组同义。 */ () => {
    expect(isEmpty(new Map())).toBe(true);
    expect(isEmpty(new Set())).toBe(true);
  });

  it('should return false for non-empty Map and Set', /** 有元素的容器不能当成空值。 */ () => {
    expect(isEmpty(new Map([['a', 1]]))).toBe(false);
    expect(isEmpty(new Set([1]))).toBe(false);
  });
});

describe('isNumber', /** 只接受有限数值，NaN 与 Infinity 都不算数字。 */ () => {
  it('should return true for finite numbers', /** 常规数字都应通过。 */ () => {
    expect(isNumber(0)).toBe(true);
    expect(isNumber(-1.5)).toBe(true);
  });

  it('should return false for NaN and Infinity', /** 这两个值参与算术会污染结果。 */ () => {
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('should return false for numeric strings', /** 字符串数字要显式解析，不能被当数值使用。 */ () => {
    expect(isNumber('1')).toBe(false);
  });

  it('should return false for other types', /** 布尔与对象都不是数值。 */ () => {
    expect(isNumber(true)).toBe(false);
    expect(isNumber({})).toBe(false);
  });
});

describe('isMacOs 与 isWindowsOs', /** 依据用户代理判断运行系统，决定默认快捷键与安装包。 */ () => {
  it('identifies macOS from the user agent', /** macintosh 是新版 macOS 的标记。 */ () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    );
    expect(isMacOs()).toBe(true);
    expect(isWindowsOs()).toBe(false);
    vi.restoreAllMocks();
  });

  it('identifies macOS by the legacy phrase', /** 老版本用户代理用 "Mac OS X" 而不是 "macintosh"。 */ () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Mac OS X 10_6_8)',
    );
    expect(isMacOs()).toBe(true);
    vi.restoreAllMocks();
  });

  it('identifies Windows from the user agent', /** Windows NT 是现代 Windows 的标记。 */ () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    );
    expect(isWindowsOs()).toBe(true);
    expect(isMacOs()).toBe(false);
    vi.restoreAllMocks();
  });

  it('identifies Win32 from the user agent', /** win32 是 32 位 Windows 的标记。 */ () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Win32)',
    );
    expect(isWindowsOs()).toBe(true);
    vi.restoreAllMocks();
  });

  it('identifies Linux as neither', /** Linux 两种判定都应为 false。 */ () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64)',
    );
    expect(isMacOs()).toBe(false);
    expect(isWindowsOs()).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('isWindow', () => {
  it('should return true for the window object', () => {
    expect(isWindow(window)).toBe(true);
  });

  it('should return false for other objects', () => {
    expect(isWindow({})).toBe(false);
    expect(isWindow([])).toBe(false);
    expect(isWindow(null)).toBe(false);
  });
});

describe('isBoolean', () => {
  it('should return true for boolean values', () => {
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(false)).toBe(true);
  });

  it('should return false for non-boolean values', () => {
    expect(isBoolean(null)).toBe(false);
    expect(isBoolean(42)).toBe(false);
    expect(isBoolean('string')).toBe(false);
    expect(isBoolean({})).toBe(false);
    expect(isBoolean([])).toBe(false);
  });
});

describe('isObject', () => {
  it('should return true for objects', () => {
    expect(isObject({})).toBe(true);
    expect(isObject({ a: 1 })).toBe(true);
  });

  it('should return false for non-objects', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject(42)).toBe(false);
    expect(isObject('string')).toBe(false);
    expect(isObject(true)).toBe(false);
    expect(isObject([1, 2, 3])).toBe(true);
    expect(isObject(new Date())).toBe(true);
    expect(isObject(/regex/)).toBe(true);
  });
});

describe('getFirstNonNullOrUndefined', () => {
  describe('getFirstNonNullOrUndefined', () => {
    it('should return the first non-null and non-undefined value for a number array', () => {
      expect(getFirstNonNullOrUndefined<number>(undefined, null, 0, 42)).toBe(
        0,
      );
      expect(getFirstNonNullOrUndefined<number>(null, undefined, 42, 123)).toBe(
        42,
      );
    });

    it('should return the first non-null and non-undefined value for a string array', () => {
      expect(
        getFirstNonNullOrUndefined<string>(undefined, null, '', 'hello'),
      ).toBe('');
      expect(
        getFirstNonNullOrUndefined<string>(null, undefined, 'test', 'world'),
      ).toBe('test');
    });

    it('should return undefined if all values are null or undefined', () => {
      expect(getFirstNonNullOrUndefined(undefined, null)).toBeUndefined();
      expect(getFirstNonNullOrUndefined(null)).toBeUndefined();
    });

    it('should work with a single value', () => {
      expect(getFirstNonNullOrUndefined(42)).toBe(42);
      expect(getFirstNonNullOrUndefined()).toBeUndefined();
      expect(getFirstNonNullOrUndefined(null)).toBeUndefined();
    });

    it('should handle mixed types correctly', () => {
      expect(
        getFirstNonNullOrUndefined<number | object | string>(
          undefined,
          null,
          'test',
          123,
          { key: 'value' },
        ),
      ).toBe('test');
      expect(
        getFirstNonNullOrUndefined<number | object | string>(
          null,
          undefined,
          [1, 2, 3],
          'string',
        ),
      ).toEqual([1, 2, 3]);
    });
  });
});

/** 日期格式化工具的测试：覆盖时区处理、无效值兜底与表格列 formatter 的取值收窄。 */
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dateFormatter,
  formatDate,
  formatDate2,
  formatDateTime,
  getCurrentTimezone,
  getSystemTimezone,
  isDate,
  isDayjsObject,
  setCurrentTimezone,
  toFormatDateValue,
} from '../date';

dayjs.extend(utc);
dayjs.extend(timezone);

describe('dateUtils', /** 日期工具测试：格式化、时区与表格列 formatter 的取值收窄。 */ () => {
  const sampleISO = '2024-10-30T12:34:56Z';
  const sampleTimestamp = Date.parse(sampleISO);

  beforeEach(() => {
    // 重置时区
    dayjs.tz.setDefault();
    setCurrentTimezone(); // 重置为系统默认
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===============================
  // formatDate
  // ===============================
  describe('formatDate', /** 统一时区格式化：缺失值返回空串，无效值回退到原文。 */ () => {
    it('should return an empty string when the time is missing', /** 无时间不能渲染出 Invalid Date。 */ () => {
      expect(formatDate()).toBe('');
      expect(formatDate(0)).toBe('');
    });

    it('should format a valid ISO date string', () => {
      const formatted = formatDate(sampleISO, 'YYYY/MM/DD');
      expect(formatted).toMatch(/2024\/10\/30/);
    });

    it('should format a timestamp correctly', () => {
      const formatted = formatDate(sampleTimestamp);
      expect(formatted).toMatch(/2024-10-30/);
    });

    it('should format a Date object', () => {
      const formatted = formatDate(new Date(sampleISO));
      expect(formatted).toMatch(/2024-10-30/);
    });

    it('should format a dayjs object', () => {
      const formatted = formatDate(dayjs(sampleISO));
      expect(formatted).toMatch(/2024-10-30/);
    });

    it('should return original input if date is invalid', () => {
      const invalid = 'not-a-date';
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const formatted = formatDate(invalid);
      expect(formatted).toBe(invalid);
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should apply given format', () => {
      const formatted = formatDate(sampleISO, 'YYYY-MM-DD HH:mm');
      expect(formatted).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    });
  });

  // ===============================
  // formatDateTime
  // ===============================
  describe('formatDateTime', /** 固定到秒的时间格式入口。 */ () => {
    it('should format date into full datetime', () => {
      const result = formatDateTime(sampleISO);
      expect(result).toMatch(/2024-10-30 \d{2}:\d{2}:\d{2}/);
    });
  });

  // ===============================
  // isDate
  // ===============================
  describe('isDate', () => {
    it('should return true for Date instances', () => {
      expect(isDate(new Date())).toBe(true);
    });

    it('should return false for non-Date values', () => {
      expect(isDate('2024-10-30')).toBe(false);
      expect(isDate(null)).toBe(false);
      expect(isDate(undefined)).toBe(false);
    });
  });

  // ===============================
  // isDayjsObject
  // ===============================
  describe('isDayjsObject', () => {
    it('should return true for dayjs objects', () => {
      expect(isDayjsObject(dayjs())).toBe(true);
    });

    it('should return false for other values', () => {
      expect(isDayjsObject(new Date())).toBe(false);
      expect(isDayjsObject('string')).toBe(false);
    });
  });

  // ===============================
  // getSystemTimezone
  // ===============================
  describe('getSystemTimezone', /** 系统时区只要求非空且被运行时接受，不绑定具体时区。 */ () => {
    /**
     * dayjs 在 UTC 配置的机器上返回 'UTC'，而 UTC、GMT、EST 都是合法 IANA 名称，
     * 强制要求 `区域/城市` 形式会把正确的运行结果判成失败。改用 Intl 构造做真实校验：
     * 非法时区名会直接抛 RangeError，比原来的正则更严格，同时不依赖具体时区。
     */
    it('should return a non-empty timezone supported by the runtime', /** 时区名必须被运行时接受且非空。 */ () => {
      const tz = getSystemTimezone();
      expect(typeof tz).toBe('string');
      expect(tz.trim()).not.toBe('');
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz });
      expect(formatter.resolvedOptions().timeZone).not.toBe('');
    });
  });

  // ===============================
  // setCurrentTimezone / getCurrentTimezone
  // ===============================
  describe('setCurrentTimezone & getCurrentTimezone', () => {
    it('should set and retrieve the current timezone', () => {
      setCurrentTimezone('Asia/Shanghai');
      expect(getCurrentTimezone()).toBe('Asia/Shanghai');
    });

    it('should reset to system timezone when called with no args', () => {
      const guessed = getSystemTimezone();
      setCurrentTimezone();
      expect(getCurrentTimezone()).toBe(guessed);
    });

    it('should update dayjs default timezone', () => {
      setCurrentTimezone('America/New_York');
      const d = dayjs('2024-01-01T00:00:00Z');
      // 校验时区转换生效（小时变化）
      expect(d.tz().format('HH')).not.toBe('00');
    });
  });
});

describe('formatDate2', /** 直接按 dayjs 格式化 Date，不做时区转换，也没有无效值兜底。 */ () => {
  it('should format a Date with the default full datetime format', /** 默认精度到秒，与旧表格列的展示一致。 */ () => {
    const result = formatDate2(new Date(2024, 9, 30, 12, 34, 56));

    expect(result).toBe('2024-10-30 12:34:56');
  });

  it('should honour a custom format', /** 传入格式串时按该格式输出。 */ () => {
    expect(formatDate2(new Date(2024, 9, 30), 'YYYY/MM/DD')).toBe('2024/10/30');
  });

  it('should return an empty string for a missing date', /** 缺少日期时不能输出 Invalid Date。 */ () => {
    /** 表格列在无数据时给出 null，运行时值确实是 null 而不是 Date。 */
    const missing = JSON.parse('null');

    expect(formatDate2(missing)).toBe('');
  });
});

describe('toFormatDateValue', /** 把表格单元格的 unknown 收窄成可格式化的时间类型。 */ () => {
  it('should pass through Date and dayjs values', /** 这两类已经是合法时间类型。 */ () => {
    const date = new Date();
    const wrapped = dayjs();

    expect(toFormatDateValue(date)).toBe(date);
    expect(toFormatDateValue(wrapped)).toBe(wrapped);
  });

  it('should pass through timestamps and date strings', /** 时间戳与字符串是接口层的常见形态。 */ () => {
    expect(toFormatDateValue(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toFormatDateValue('2024-10-30')).toBe('2024-10-30');
  });

  it('should return undefined for other types', /** 布尔与对象不能当时间戳解释，否则会渲染出错误年份。 */ () => {
    expect(toFormatDateValue(true)).toBeUndefined();
    expect(toFormatDateValue({ year: 2024 })).toBeUndefined();
    expect(toFormatDateValue(null)).toBeUndefined();
  });
});

describe('dateFormatter', /** element-plus 时间列的 formatter，非法取值一律渲染成空串。 */ () => {
  it('should format a valid cell value with the default date-only format', /** 当前实现走 formatDate 的默认格式，只输出日期；与其注释声明的 YYYY-MM-DD HH:mm:ss 不一致。 */ () => {
    const cell = new Date(2024, 9, 30, 12, 34, 56).getTime();

    expect(dateFormatter(undefined, undefined, cell)).toBe('2024-10-30');
  });

  it('should render an empty string for a non-date cell value', /** 布尔值不是时间，不能当成时间戳解释。 */ () => {
    expect(dateFormatter(undefined, undefined, true)).toBe('');
  });

  it('should render an empty string for a missing cell value', /** 空单元格不能显示 Invalid Date。 */ () => {
    expect(dateFormatter(undefined, undefined, null)).toBe('');
    expect(dateFormatter(undefined, undefined, 0)).toBe('');
  });
});

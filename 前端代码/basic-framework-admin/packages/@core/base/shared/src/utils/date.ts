import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

type FormatDate = Date | dayjs.Dayjs | number | string;

type Format =
  | 'HH'
  | 'HH:mm'
  | 'HH:mm:ss'
  | 'YYYY'
  | 'YYYY-MM'
  | 'YYYY-MM-DD'
  | 'YYYY-MM-DD HH'
  | 'YYYY-MM-DD HH:mm'
  | 'YYYY-MM-DD HH:mm:ss'
  | (string & {});

export function formatDate(time?: FormatDate, format: Format = 'YYYY-MM-DD') {
  // 日期不存在，则返回空
  if (!time) {
    return '';
  }
  try {
    const date = dayjs.isDayjs(time) ? time : dayjs(time);
    if (!date.isValid()) {
      throw new Error('Invalid date');
    }
    return date.tz().format(format);
  } catch (error) {
    console.error(`Error formatting date: ${error}`);
    return String(time ?? '');
  }
}

export function formatDateTime(time?: FormatDate) {
  return formatDate(time, 'YYYY-MM-DD HH:mm:ss');
}

export function formatDate2(date: Date, format?: string): string {
  // 日期不存在，则返回空
  if (!date) {
    return '';
  }
  // 日期存在，则进行格式化
  return date ? dayjs(date).format(format ?? 'YYYY-MM-DD HH:mm:ss') : '';
}

/**
 * 判断传入值是否为原生 Date 实例。
 * @param value 待判断的值，允许任意类型，便于在未收窄的入参上直接使用。
 * @returns 是 Date 实例时返回 true。
 */
export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

/**
 * 判断传入值是否为 dayjs 对象。
 * @param value 待判断的值，允许任意类型，便于在未收窄的入参上直接使用。
 * @returns 是 dayjs 对象时返回 true。
 */
export function isDayjsObject(value: unknown): value is dayjs.Dayjs {
  return dayjs.isDayjs(value);
}

/**
 * 把表格单元格的任意取值收窄为可格式化的日期类型。
 * vxe / element-plus 的列 formatter 拿到的字段值是 unknown，
 * 而日期列的真实取值只可能是时间戳、时间字符串或 Date；
 * 其余取值按「无法格式化」处理，避免把布尔或对象当成时间戳产生误导性输出。
 * @param value 单元格取值。
 * @returns 可交给 formatDate 的值；不是日期类型时返回 undefined，由 formatDate 输出空串。
 */
export function toFormatDateValue(value: unknown): FormatDate | undefined {
  if (isDate(value) || isDayjsObject(value)) {
    return value;
  }
  return typeof value === 'number' || typeof value === 'string'
    ? value
    : undefined;
}

/**
 * element plus 的时间 Formatter 实现，使用 YYYY-MM-DD HH:mm:ss 格式
 *
 * @param _row 行数据，Element Plus 固定传入，此处不使用
 * @param _column 列定义，Element Plus 固定传入，此处不使用
 * @param cellValue 字段值，按 unknown 接收后收窄为日期类型，非法值一律渲染为空串
 * @returns 格式化后的时间文本；cellValue 为空或不是日期类型时返回空串
 */
export function dateFormatter(
  _row: unknown,
  _column: unknown,
  cellValue: unknown,
): string {
  const date = toFormatDateValue(cellValue);
  return date ? formatDate(date)?.toString() || '' : '';
}

/**
 * 获取当前时区
 * @returns 当前时区
 */
export const getSystemTimezone = () => {
  return dayjs.tz.guess();
};

/**
 * 自定义设置的时区
 */
let currentTimezone = getSystemTimezone();

/**
 * 设置默认时区
 * @param timezone
 */
export const setCurrentTimezone = (timezone?: string) => {
  currentTimezone = timezone || getSystemTimezone();
  dayjs.tz.setDefault(currentTimezone);
};

/**
 * 获取设置的时区
 * @returns 设置的时区
 */
export const getCurrentTimezone = () => {
  return currentTimezone;
};

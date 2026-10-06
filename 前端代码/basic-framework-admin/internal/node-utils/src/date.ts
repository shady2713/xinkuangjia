/**
 * 日期工具：导出已挂载 UTC 与时区插件的 dayjs 实例。
 * 默认时区固定为 Asia/Shanghai，供构建脚本按东八区格式化时间戳；
 * 不做业务日期计算，也不额外导出其他 dayjs 插件。
 */
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

dayjs.tz.setDefault('Asia/Shanghai');

const dateUtil = dayjs;

export { dateUtil };

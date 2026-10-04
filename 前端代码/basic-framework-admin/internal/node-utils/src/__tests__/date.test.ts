/** 校验共享 dayjs 实例的插件注册与默认时区，防止构建脚本按错误的时区格式化时间。 */
import { describe, expect, it } from 'vitest';

import { dateUtil } from '../date';

describe('dateUtil 共享 dayjs 实例', /** 构建信息与日志时间都复用该实例，插件或默认时区缺失会静默产出错误时间文本。 */ () => {
  it('已注册 utc 与 timezone 插件并暴露对应入口', /** 两个插件分别提供 utc 转换和 tz 命名空间，缺失时调用处才会在运行期报错。 */ () => {
    expect(typeof dateUtil.utc).toBe('function');
    expect(typeof dateUtil.tz).toBe('function');
    expect(typeof dateUtil.tz.guess).toBe('function');
  });

  it('未显式指定时区时按东八区解释', /** 不依赖宿主 TZ：默认时区必须是 Asia/Shanghai，偏移与格式化结果都要一致。 */ () => {
    expect(dateUtil.tz().utcOffset()).toBe(480);
    expect(dateUtil.tz('2024-01-01 00:00:00').format('Z')).toBe('+08:00');
  });

  it('命名时区与 utc 换算得到同一时刻', /** 同一墙上时间在东八区比 UTC 早 8 小时，用两种入口分别核对换算方向。 */ () => {
    const shanghai = dateUtil.tz('2024-01-01 00:00:00', 'Asia/Shanghai');
    expect(shanghai.format('YYYY-MM-DD HH:mm:ss')).toBe('2024-01-01 00:00:00');
    expect(shanghai.utc().format('YYYY-MM-DD HH:mm:ss')).toBe(
      '2023-12-31 16:00:00',
    );
  });
});

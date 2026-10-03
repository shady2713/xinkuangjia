/** 时间工具的测试：占位符格式化、相对时间、问候语、日界计算与常用时间区间。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDate } from '../date';
import {
  addTime,
  beginOfDay,
  betweenDay,
  convertDate,
  endOfDay,
  formatAxis,
  formatPast,
  formatPast2,
  formatTime,
  getDateRange,
  getDayRange,
  getLast1Year,
  getLast7Days,
  getLast30Days,
  getWeek,
  isSameDay,
} from '../time';

/** 只伪造 Date，保留其余计时器行为，避免影响 dayjs 与其它用例。 */
beforeEach(
  /** 每个用例都从同一个"当前时间"出发，保证相对时间可断言。 */ () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2024, 2, 15, 10, 0, 0));
  },
);

afterEach(
  /** 交还真实时钟，避免影响其它测试文件。 */ () => {
    vi.useRealTimers();
  },
);

describe('formatTime', /** 自定义占位符格式化：年按占位符长度截取，其余占位符补零后取前 N 位。 */ () => {
  it('按占位符拼出完整时间', /** yyyy-MM-dd HH:mm:ss 是列表页最常用的展示格式。 */ () => {
    expect(
      formatTime(new Date(2024, 0, 5, 9, 8, 7), 'yyyy-MM-dd HH:mm:ss'),
    ).toBe('2024-01-05 09:08:07');
  });

  it('单个占位符不补零', /** M+ 单字符时直接输出数值，不强制两位。 */ () => {
    expect(formatTime(new Date(2024, 0, 5), 'M')).toBe('1');
  });

  it('多字符占位符按原值长度截取', /** mm 表示两位分钟，09 不能被截成 9。 */ () => {
    expect(formatTime(new Date(2024, 0, 5, 0, 9), 'mm')).toBe('09');
  });

  it('年份占位符越短越靠后取位', /** yy 取后两位，y 取完整年份。 */ () => {
    const date = new Date(2024, 0, 5);
    expect(formatTime(date, 'yy')).toBe('24');
    expect(formatTime(date, 'yyyy')).toBe('2024');
  });

  it('季度占位符会残留一个加号', /** 占位符名里的 + 在正则里被当作量词，q+ 实际只匹配 q，输出会带上多余的 +。 */ () => {
    const date = new Date(2024, 4, 20, 1, 2, 3, 45);
    expect(formatTime(date, 'q+')).toBe('2+');
  });

  it('毫秒占位符 S', /** S 不带加号，因此没有同样的残留问题。 */ () => {
    expect(formatTime(new Date(2024, 4, 20, 1, 2, 3, 45), 'S')).toBe('45');
  });

  it('格式串里没有的占位符保持原样', /** 缺少 y 时不应把年份追加进结果。 */ () => {
    expect(formatTime(new Date(2024, 0, 5), 'MM-dd')).toBe('01-05');
  });

  it('接受时间戳与时间字符串', /** 表格列可能给出数字或 ISO 字符串。 */ () => {
    const date = new Date(2024, 0, 5);
    expect(formatTime(date.getTime(), 'yyyy')).toBe('2024');
    expect(formatTime('2024-01-05T00:00:00', 'yyyy')).toBe('2024');
  });

  it('时间为 0 时返回空串', /** 时间戳 0 是合法入参但业务上表示未采集，不能渲染成 1970。 */ () => {
    expect(formatTime(0, 'yyyy-MM-dd')).toBe('');
  });
});

describe('getWeek', /** 返回日期在当年的第几周：周日与次日周一属于同一周，整周推进则加一。 */ () => {
  it('周一与同周的周日属于同一周', /** 算法把周日视为一周的最后一天（getDay()||7），因此周界是周一到周日。 */ () => {
    const monday = new Date(2024, 5, 17);
    const sunday = new Date(2024, 5, 23);

    expect(getWeek(sunday)).toBe(getWeek(monday));
  });

  it('相隔七天则周数加一', /** 周数必须随时间线性推进。 */ () => {
    const base = new Date(2024, 5, 12);
    const nextWeek = new Date(2024, 5, 19);

    expect(getWeek(nextWeek)).toBe(getWeek(base) + 1);
  });

  it('1 月 1 日为周日与非周日的年份都能算出周数', /** 两条 spendDay 分支都要走到，结果都应为正整数。 */ () => {
    for (const date of [new Date(2023, 5, 15), new Date(2024, 5, 15)]) {
      expect(Number.isInteger(getWeek(date))).toBe(true);
      expect(getWeek(date)).toBeGreaterThan(0);
    }
  });

  it('不修改传入的日期对象', /** 内部会调整日期副本，调用方的入参不能被改写。 */ () => {
    const date = new Date(2024, 5, 12);

    getWeek(date);

    expect(date.getDate()).toBe(12);
  });
});

describe('formatPast', /** 相对时间文案：不足 10 秒显示"刚刚"，超过 3 天改为绝对日期。 */ () => {
  it('不足 10 秒显示刚刚', /** 刚发生的操作不需要显示秒数。 */ () => {
    expect(formatPast(new Date(2024, 2, 15, 9, 59, 55))).toBe('刚刚');
  });

  it('不足 1 分钟显示秒数', /** 10 秒到 59 秒之间按秒取整。 */ () => {
    expect(formatPast(new Date(2024, 2, 15, 9, 59, 30))).toBe('30秒前');
  });

  it('不足 1 小时显示分钟', /** 秒数超过 60 后切换为分钟。 */ () => {
    expect(formatPast(new Date(2024, 2, 15, 9, 30, 0))).toBe('30分钟前');
  });

  it('不足 1 天显示小时', /** 分钟超过 60 后切换为小时。 */ () => {
    expect(formatPast(new Date(2024, 2, 15, 1, 0, 0))).toBe('9小时前');
  });

  it('不超过 3 天显示天数', /** 小时超过 24 后切换为天。 */ () => {
    expect(formatPast(new Date(2024, 2, 13, 10, 0, 0))).toBe('2天前');
  });

  it('超过 3 天改为绝对日期', /** 再久远的时间用相对描述没有意义。 */ () => {
    expect(formatPast(new Date(2024, 1, 1, 10, 0, 0))).toBe(
      '2024-02-01 10:00:00',
    );
  });

  it('字符串入参走浏览器解析规则', /** 接口返回的时间字符串要与 Date 入参得到同样的结果。 */ () => {
    expect(formatPast('2024-03-15 09:30:00')).toBe('30分钟前');
  });

  it('时间戳入参按数值走非对象分支', /** 历史调用方直接传毫秒数；此时不能按对象分支处理，否则相对时间会算错。 */ () => {
    /** 旧版调用方直接传毫秒时间戳，运行时值确实是数字。 */
    const recent: Date = JSON.parse(
      String(new Date(2024, 2, 15, 9, 59, 55).getTime()),
    );
    const old: Date = JSON.parse(
      String(new Date(2024, 0, 1, 10, 0, 0).getTime()),
    );

    const recentText = formatPast(recent);
    const oldText = formatPast(old);

    expect(recentText).toBe('刚刚');
    expect(oldText).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/u);
  });

  it('自定义超过 3 天后的格式', /** 不同列表可以指定自己的绝对时间格式。 */ () => {
    expect(formatPast(new Date(2024, 0, 1), 'YYYY/MM/DD')).toBe('2024/01/01');
  });
});

describe('formatAxis', /** 按小时返回问候语，八个时段各自独立。 */ () => {
  it('按小时返回对应问候语', /** 每个时段边界都要命中不同的文案。 */ () => {
    const greetings = [0, 7, 10, 13, 15, 18, 20, 23].map(
      /** 用本地时间构造当天该小时的日期。 */ (hour) => {
        const date = new Date(2024, 0, 1, hour);
        return formatAxis(date);
      },
    );

    expect(greetings).toEqual([
      '凌晨好',
      '早上好',
      '上午好',
      '中午好',
      '下午好',
      '傍晚好',
      '晚上好',
      '夜里好',
    ]);
  });
});

describe('formatPast2', /** 把毫秒差拆成天/小时/分钟/秒的可读描述。 */ () => {
  it('不足一天按小时与分钟输出', /** 90 分钟应读作 1 小时 30 分钟。 */ () => {
    expect(formatPast2(90 * 60 * 1000)).toBe('1 小时 30 分钟');
  });

  it('不足一小时按分钟输出', /** 5 分钟不显示小时段。 */ () => {
    expect(formatPast2(5 * 60 * 1000)).toBe('5 分钟');
  });

  it('不足一分钟按秒输出', /** 30 秒不显示分钟段。 */ () => {
    expect(formatPast2(30_000)).toBe('30 秒');
  });

  it('不足一秒输出 0 秒', /** 毫秒差为 0 时不能输出空串。 */ () => {
    expect(formatPast2(0)).toBe('0 秒');
  });

  it('超过一天按天与小时输出', /** 超过 24 小时后段位为天。 */ () => {
    expect(formatPast2(26 * 60 * 60 * 1000)).toBe('1 天2 小时 0 分钟');
  });
});

describe('beginOfDay 与 endOfDay', /** 把日期收敛到当天起点或终点，用于按天筛选。 */ () => {
  it('起始日为当天 00:00:00', /** 时分秒全部归零。 */ () => {
    const result = beginOfDay(new Date(2024, 2, 15, 13, 45, 30));

    expect([
      result.getHours(),
      result.getMinutes(),
      result.getSeconds(),
    ]).toEqual([0, 0, 0]);
    expect(result.getDate()).toBe(15);
  });

  it('截止日为当天 23:59:59', /** 用闭区间按天筛选时必须包含当天最后一秒。 */ () => {
    const result = endOfDay(new Date(2024, 2, 15, 1, 2, 3));

    expect([
      result.getHours(),
      result.getMinutes(),
      result.getSeconds(),
    ]).toEqual([23, 59, 59]);
  });

  it('不修改传入的日期对象', /** 收敛结果必须是新对象，不能影响调用方的原值。 */ () => {
    const date = new Date(2024, 2, 15, 13, 45, 30);

    beginOfDay(date);

    expect(date.getHours()).toBe(13);
  });
});

describe('betweenDay 与 addTime', /** 跨天计算与时间偏移。 */ () => {
  it('同一天返回 0', /** 同一天不能被算成 1 天。 */ () => {
    expect(
      betweenDay(new Date(2024, 2, 15, 1), new Date(2024, 2, 15, 23)),
    ).toBe(0);
  });

  it('跨天按整天差向下取整', /** 不足一整天向下取整，不产生小数。 */ () => {
    expect(
      betweenDay(new Date(2024, 2, 15, 23), new Date(2024, 2, 16, 1)),
    ).toBe(0);
  });

  it('相差整两天返回 2', /** 时间跨度按 24 小时为单位计算。 */ () => {
    expect(
      betweenDay(new Date(2024, 2, 15, 10), new Date(2024, 2, 17, 10)),
    ).toBe(2);
  });

  it('按毫秒偏移得到新日期', /** 加减时间都通过 addTime 完成。 */ () => {
    const base = new Date(2024, 2, 15, 10, 0, 0);

    expect(addTime(base, 3_600_000).getHours()).toBe(11);
    expect(addTime(base, -3_600_000).getHours()).toBe(9);
  });
});

describe('convertDate', /** 统一把字符串或 Date 转成 Date，供后续计算复用。 */ () => {
  it('字符串按浏览器规则解析', /** '2024-03-15' 解析为当天零点。 */ () => {
    const result = convertDate('2024-03-15');

    expect(result).toBeInstanceOf(Date);
    expect(result.getDate()).toBe(15);
  });

  it('date 原样返回同一对象', /** 已经是 Date 时不做无谓拷贝。 */ () => {
    const date = new Date(2024, 2, 15);

    expect(convertDate(date)).toBe(date);
  });
});

describe('isSameDay', /** 判断两个时间是否落在同一天，用于列表按天高亮。 */ () => {
  it('同一天不同时刻判定为同一天', /** 时刻不同不影响按天比较。 */ () => {
    expect(isSameDay(new Date(2024, 2, 15, 1), new Date(2024, 2, 15, 23))).toBe(
      true,
    );
  });

  it('不同日期判定为不同天', /** 跨天后必须为 false。 */ () => {
    expect(isSameDay(new Date(2024, 2, 15, 23), new Date(2024, 2, 16, 1))).toBe(
      false,
    );
  });

  it('任一侧为空时返回 false', /** 缺时间时不能判定为同一天。 */ () => {
    expect(isSameDay(undefined, new Date())).toBe(false);
    expect(isSameDay(new Date(), null)).toBe(false);
  });
});

describe('时间区间', /** 常用查询区间统一返回"起始日 00:00:00 ~ 截止日 23:59:59"。 */ () => {
  it('getDateRange 返回当天首尾', /** 闭区间必须覆盖截止日的最后一秒。 */ () => {
    expect(getDateRange('2024-03-10', '2024-03-12')).toEqual([
      '2024-03-10 00:00:00',
      '2024-03-12 23:59:59',
    ]);
  });

  it('getDayRange 把同一天的首尾都取出来', /** 传 0 天时起止落在同一天。 */ () => {
    expect(getDayRange('2024-03-10', 0)).toEqual([
      '2024-03-10 00:00:00',
      '2024-03-10 23:59:59',
    ]);
  });

  it('getDayRange 偏移指定天数', /** 传 3 天时结束日是基准日加 3 天。 */ () => {
    expect(getDayRange('2024-03-10', 3)[0]).toBe('2024-03-13 00:00:00');
  });

  it('最近 7 天以昨天为截止', /** 报表默认不含今天，避免当天数据不完整。 */ () => {
    expect(getLast7Days()).toEqual([
      '2024-03-08 00:00:00',
      '2024-03-14 23:59:59',
    ]);
  });

  it('最近 30 天以昨天为截止', /** 30 天窗口同样排除当天。 */ () => {
    expect(getLast30Days()).toEqual([
      '2024-02-14 00:00:00',
      '2024-03-14 23:59:59',
    ]);
  });

  it('最近 1 年以昨天为截止', /** 年度窗口按自然年回退一年。 */ () => {
    expect(getLast1Year()).toEqual([
      '2023-03-15 00:00:00',
      '2024-03-14 23:59:59',
    ]);
  });
});

describe('formatDate 契约复核', /** time 模块依赖 date 模块的格式化结果，两者的输出必须一致。 */ () => {
  it('超过 3 天的相对时间直接复用 date 模块格式', /** 两处格式不一致会导致列表与详情显示不同时间。 */ () => {
    const past = new Date(2024, 0, 1, 10, 0, 0);

    expect(formatPast(past)).toBe(formatDate(past, 'YYYY-MM-DD HH:mm:ss'));
  });
});

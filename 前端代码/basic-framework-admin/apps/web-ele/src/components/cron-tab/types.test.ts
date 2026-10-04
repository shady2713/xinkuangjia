/**
 * CRON 组件类型与默认值（components/cron-tab/types）真实行为回归。
 *
 * 该模块向 CRON 面板提供默认调度值与候选项：默认值结构写错会让面板回填出错误的时间
 * 单位；星期缺少“最后一周”语义会让“每月最后一个周几”无法表达；年份候选写死会让
 * 面板在跨年后无法选择当年之后的执行时间。用例真实读取每个导出常量并核对取值口径，
 * 不修改被测模块的任何状态。
 */
import { describe, expect, it } from 'vitest';

import { CronDataDefault, CronValueDefault } from './types';

/** 年份候选的个数：面板固定给出当前年份起算的 11 年。 */
const YEAR_COUNT = 11;

/** 当前年份：默认值的年份区间与候选都由它起算。 */
const CURRENT_YEAR = new Date().getFullYear();

/** 七个时间单位的键顺序，决定面板回填顺序。 */
const UNIT_KEYS = [
  'second',
  'minute',
  'hour',
  'day',
  'month',
  'week',
  'year',
] as const;

describe('cRON 默认调度值', /** 默认值决定面板首次打开时各时间单位的回填内容。 */ () => {
  it('按七个时间单位给出完整结构', /** 缺少时间单位会让面板回填出 undefined 并报错。 */ () => {
    expect(Object.keys(CronValueDefault).toSorted()).toEqual(
      [...UNIT_KEYS].toSorted(),
    );
  });

  it('秒、分、时默认走区间模式', /** 默认模式写错会让面板打开时命中错误的调度语义。 */ () => {
    for (const key of ['second', 'minute', 'hour'] as const) {
      expect(CronValueDefault[key]).toEqual({
        appoint: [],
        loop: { end: 1, start: 0 },
        range: { end: 2, start: 1 },
        type: '0',
      });
    }
  });

  it('日与月默认从第 1 天起算', /** 日或月从 0 起算会生成不存在的调度时刻。 */ () => {
    for (const key of ['day', 'month'] as const) {
      expect(CronValueDefault[key]).toEqual({
        appoint: [],
        loop: { end: 1, start: 1 },
        range: { end: 2, start: 1 },
        type: '0',
      });
    }
  });

  it('星期保留字符串区间与最后一周语义', /** 丢掉 last 会让“每月最后一个周几”无法表达，区间类型写错会让面板回填失败。 */ () => {
    expect(CronValueDefault.week).toEqual({
      appoint: [],
      last: '2',
      loop: { end: '2', start: 0 },
      range: { end: '3', start: '2' },
      type: '5',
    });
  });

  it('年份区间以当前年份起算且不启用', /** 年份写死会让面板跨年后仍回填过期年份。 */ () => {
    expect(CronValueDefault.year.type).toBe('-1');
    expect(CronValueDefault.year.range).toEqual({
      end: CURRENT_YEAR + 1,
      start: CURRENT_YEAR,
    });
    expect(CronValueDefault.year.loop.start).toBe(CURRENT_YEAR);
    expect(CronValueDefault.year.appoint).toEqual([]);
  });

  it('各时间单位持有独立对象', /** 共用同一对象会让面板修改一个单位时连带改掉其它单位。 */ () => {
    expect(CronValueDefault.second).not.toBe(CronValueDefault.minute);
    expect(CronValueDefault.second.range).not.toBe(
      CronValueDefault.minute.range,
    );
    expect(CronValueDefault.day.range).not.toBe(CronValueDefault.month.range);
  });
});

describe('cRON 候选项默认值', /** 候选项决定面板上可点击的时间单位取值。 */ () => {
  it('秒与分钟给出 12 个常用步长', /** 缺少常用步长会让用户只能逐个输入取值。 */ () => {
    for (const key of ['second', 'minute'] as const) {
      const options = CronDataDefault[key];
      expect(options).toHaveLength(12);
      expect(options[0]).toBe('0');
      expect(options.at(-1)).toBe('59');
      expect(
        options.every(
          /** 每个候选项都必须是可解析的整点数字文本。 */ (value) =>
            String(Number.parseInt(value, 10)) === value,
        ),
      ).toBe(true);
    }
  });

  it('小时覆盖 0 到 23', /** 缺少小时会让用户在一天内无法选择该时刻。 */ () => {
    expect(CronDataDefault.hour).toHaveLength(24);
    expect(CronDataDefault.hour[0]).toBe('0');
    expect(CronDataDefault.hour.at(-1)).toBe('23');
  });

  it('日覆盖 1 到 31', /** 缺少日期会让用户在长月份无法选择该日。 */ () => {
    expect(CronDataDefault.day).toHaveLength(31);
    expect(CronDataDefault.day[0]).toBe('1');
    expect(CronDataDefault.day.at(-1)).toBe('31');
  });

  it('月覆盖 1 到 12', /** 缺少月份会让用户无法选择该月。 */ () => {
    expect(CronDataDefault.month).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
  });

  it('星期给出 1 到 7 的中文标签', /** 取值与标签错位会让用户选到错误的星期。 */ () => {
    expect(CronDataDefault.week).toEqual([
      { label: '周日', value: '1' },
      { label: '周一', value: '2' },
      { label: '周二', value: '3' },
      { label: '周三', value: '4' },
      { label: '周四', value: '5' },
      { label: '周五', value: '6' },
      { label: '周六', value: '7' },
    ]);
  });

  it('年份由当前年份起算 11 年', /** 年份候选写死会让面板跨年后无法选择当年之后的执行时间。 */ () => {
    expect(CronDataDefault.year).toEqual(
      Array.from(
        { length: YEAR_COUNT },
        /** 按序号生成连续年份候选。 */ (_value, index) => CURRENT_YEAR + index,
      ),
    );
    expect(CronDataDefault.year[0]).toBe(CURRENT_YEAR);
  });
});

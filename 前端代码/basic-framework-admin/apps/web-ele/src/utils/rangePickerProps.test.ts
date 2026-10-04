/**
 * 时间段选择器默认属性（utils/rangePickerProps）的真实行为回归。
 *
 * 文件、配置、登录日志、用户、角色、操作日志六个列表页都用它拼查询条件：
 * 绑定格式写错会让后端收到无法解析的时间串，快捷区间算错会让用户查到错误日期段的
 * 数据，占位文案取错语言键会显示成英文键名。用例只替换翻译边界，属性值、快捷区间的
 * dayjs 计算与对象新建保持真实实现。
 */
import dayjs, { isDayjs } from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { $t } from '#/locales';

import { getRangePickerDefaultProps } from './rangePickerProps';

vi.mock(
  '#/locales',
  /** 只替换翻译边界，属性值与快捷时间计算保持真实实现。 */ () => ({
    $t: vi.fn(
      /** 把语言键回显成可预期的译文，便于核对请求的键。 */
      (key: string) => `译文:${key}`,
    ),
  }),
);

/** 被测模块向翻译函数请求的语言键；顺序即占位文案与快捷项的声明顺序。 */
const EXPECTED_KEYS = [
  'utils.rangePicker.beginTime',
  'utils.rangePicker.endTime',
  'utils.rangePicker.today',
  'utils.rangePicker.yesterday',
  'utils.rangePicker.last7Days',
  'utils.rangePicker.last30Days',
  'utils.rangePicker.thisWeek',
  'utils.rangePicker.lastWeek',
  'utils.rangePicker.thisMonth',
];

/**
 * 取出快捷项的时间范围并校验其形状。
 *
 * 生产实现把 dayjs 时刻数组交给 Element Plus 消费，形状写错会让快捷查询静默失效，
 * 因此这里按真实运行结果校验而不是断言类型。
 *
 * @param props 被测函数返回的默认属性对象。
 * @param index 快捷项在 shortcuts 数组中的下标。
 * @returns 该快捷项的起止时刻。
 * @throws Error 快捷项缺失、没有计算函数或返回的不是两个 dayjs 时刻时抛出。
 */
function shortcutRange(
  props: ReturnType<typeof getRangePickerDefaultProps>,
  index: number,
) {
  const shortcut = props.shortcuts[index];
  if (!shortcut || typeof shortcut.value !== 'function') {
    throw new Error(`第 ${index} 个快捷项缺少时间范围计算函数`);
  }
  const range: unknown = shortcut.value();
  if (!Array.isArray(range) || range.length !== 2) {
    throw new Error(`第 ${index} 个快捷项必须返回起止两个时刻`);
  }
  const start: unknown = range[0];
  const end: unknown = range[1];
  if (!isDayjs(start) || !isDayjs(end)) {
    throw new Error(`第 ${index} 个快捷项返回的不是 dayjs 时刻`);
  }
  return { end, start };
}

beforeEach(
  /** 清空上一例的翻译调用记录，避免调用顺序断言被污染。 */ () => {
    vi.mocked($t).mockClear();
  },
);

describe('时间段选择器绑定格式', /** 绑定格式决定后端收到的时间串形状，必须与接口口径一致。 */ () => {
  it('显示格式与绑定值格式都是秒级完整时间', /** 缺秒或换格式会让后端解析失败或丢失精度。 */ () => {
    const props = getRangePickerDefaultProps();

    expect(props.format).toBe('YYYY-MM-DD HH:mm:ss');
    expect(props.valueFormat).toBe('YYYY-MM-DD HH:mm:ss');
  });

  it('默认时刻覆盖当天起止边界', /** 用户只选日期时，起止时刻必须补齐为整天范围。 */ () => {
    const props = getRangePickerDefaultProps();
    const start = props.defaultTime[0];
    const end = props.defaultTime[1];
    if (!start || !end) {
      throw new Error('默认时刻必须包含起止两个 Date');
    }

    expect(start.getTime()).toBe(new Date('1 00:00:00').getTime());
    expect(end.getTime()).toBe(new Date('1 23:59:59').getTime());
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it('两次调用返回互不共享的对象', /** 调用方会就地展开或改写属性，共享引用会串改其它列表页的查询条件。 */ () => {
    const first = getRangePickerDefaultProps();
    const second = getRangePickerDefaultProps();

    expect(first).not.toBe(second);
    expect(first.defaultTime[0]).not.toBe(second.defaultTime[0]);
    expect(first.shortcuts[0]).not.toBe(second.shortcuts[0]);
  });
});

describe('时间段选择器文案', /** 占位文案与快捷项文案必须取到真实语言键，否则页面显示键名。 */ () => {
  it('按固定顺序请求全部时间范围语言键', /** 语言键写错或漏取会让对应文案回退成键名。 */ () => {
    getRangePickerDefaultProps();

    expect(
      vi
        .mocked($t)
        .mock.calls.map(/** 取出本次调用请求的语言键。 */ ([key]) => key),
    ).toEqual(EXPECTED_KEYS);
  });

  it('占位文案与快捷项文案使用翻译结果', /** 翻译结果必须落到返回值上，而不是丢弃后保留中文兜底。 */ () => {
    const props = getRangePickerDefaultProps();

    expect(props.startPlaceholder).toBe('译文:utils.rangePicker.beginTime');
    expect(props.endPlaceholder).toBe('译文:utils.rangePicker.endTime');
    expect(
      props.shortcuts.map(
        /** 取出每个快捷项展示文案用于顺序核对。 */ (shortcut) => shortcut.text,
      ),
    ).toEqual(
      EXPECTED_KEYS.slice(2).map(
        /** 按语言键拼出预期译文，与组件返回值逐项比对。 */ (key) =>
          `译文:${key}`,
      ),
    );
  });

  it('提供七个常用时间范围快捷项', /** 快捷项数量与顺序是页面交互契约，缺失会让用户少一个常用区间。 */ () => {
    const props = getRangePickerDefaultProps();

    expect(props.shortcuts).toHaveLength(7);
  });
});

describe('时间段选择器快捷区间', /** 快捷区间直接决定查询范围，算错会查到错误日期段的数据。 */ () => {
  it('今天覆盖当天零点到当天末尾', /** 起止必须落在同一天，否则会跨天查出多余数据。 */ () => {
    const { end, start } = shortcutRange(getRangePickerDefaultProps(), 0);

    expect(start.isSame(dayjs().startOf('day'))).toBe(true);
    expect(end.isSame(dayjs().endOf('day'))).toBe(true);
    expect(start.isSame(end, 'day')).toBe(true);
  });

  it('昨天覆盖前一天零点到前一天末尾', /** 偏移量写错会把今天的数据算成昨天。 */ () => {
    const { end, start } = shortcutRange(getRangePickerDefaultProps(), 1);

    expect(start.isSame(dayjs().subtract(1, 'day').startOf('day'))).toBe(true);
    expect(end.isSame(dayjs().subtract(1, 'day').endOf('day'))).toBe(true);
  });

  it('最近七天从七天前的零点算到今天末尾', /** 区间少算一天会漏掉最早一天的数据。 */ () => {
    const { end, start } = shortcutRange(getRangePickerDefaultProps(), 2);

    expect(start.isSame(dayjs().subtract(7, 'day').startOf('day'))).toBe(true);
    expect(end.isSame(dayjs().endOf('day'))).toBe(true);
  });

  it('最近三十天从三十天前的零点算到今天末尾', /** 区间偏移写错会让月度统计口径不一致。 */ () => {
    const { end, start } = shortcutRange(getRangePickerDefaultProps(), 3);

    expect(start.isSame(dayjs().subtract(30, 'day').startOf('day'))).toBe(true);
    expect(end.isSame(dayjs().endOf('day'))).toBe(true);
  });

  it('本周从本周首日零点算到今天末尾', /** 周起始口径必须与后端一致，否则周报范围错位。 */ () => {
    const { end, start } = shortcutRange(getRangePickerDefaultProps(), 4);

    expect(start.isSame(dayjs().startOf('week'))).toBe(true);
    expect(end.isSame(dayjs().endOf('day'))).toBe(true);
  });

  it('上周从上周首日零点算到今天末尾', /** 上周区间同样要覆盖到今天，保证导出数据与页面一致。 */ () => {
    const { end, start } = shortcutRange(getRangePickerDefaultProps(), 5);

    expect(start.isSame(dayjs().subtract(1, 'week').startOf('day'))).toBe(true);
    expect(end.isSame(dayjs().endOf('day'))).toBe(true);
  });

  it('本月从本月首日零点算到今天末尾', /** 月起始口径错误会让当月统计包含上月数据。 */ () => {
    const { end, start } = shortcutRange(getRangePickerDefaultProps(), 6);

    expect(start.isSame(dayjs().startOf('month'))).toBe(true);
    expect(end.isSame(dayjs().endOf('day'))).toBe(true);
  });
});

/**
 * CRON 面板的数据契约与初始值：描述秒到年各时间单位的结构与候选项。
 * 时间单位用 range、loop、appoint 三种互斥模式表达，CronValueDefault 给出
 * 面板初始值，CronDataDefault 给出候选项列表；cron 字符串的解析与拼装由
 * cron-tab.vue 负责，本文件只声明结构与默认值。
 */
export interface ShortcutsType {
  text: string;
  value: string;
}

/** 固定区间模式的端点：start 为起始值，end 为结束值，闭区间两端都可等于 undefined 表示不设限。 */
export interface CronRange<T = number> {
  start: T | undefined;
  end: T | undefined;
}

/** 周期模式的区间：与固定区间不同，两端允许是不同类型（如周以字符串表示、步长用数字）。 */
export interface CronLoop<TStart = number, TEnd = number> {
  start: TStart | undefined;
  end: TEnd | undefined;
}

/**
 * 单个时间单位的调度配置。
 * 三种模式互斥使用：range 给固定区间，loop 给周期区间，appoint 给出具体时刻列表。
 * @template TRange 区间端点类型，通常是数字。
 * @template TLoopStart 周期起始类型，通常是数字。
 * @template TLoopEnd 周期结束类型，通常是数字。
 */
export interface CronItem<
  TRange = number,
  TLoopStart = number,
  TLoopEnd = number,
> {
  type: string;
  range: CronRange<TRange>;
  loop: CronLoop<TLoopStart, TLoopEnd>;
  appoint: string[];
  last?: string;
}

/** 面板当前选中的调度值：键与 CRON 字段一一对应，缺哪个字段就不参与表达式拼装。 */
export interface CronValue {
  second: CronItem;
  minute: CronItem;
  hour: CronItem;
  day: CronItem;
  month: CronItem;
  week: CronItem<string, number, string> & { last: string };
  year: CronItem;
}

/** 星期候选项：value 参与 CRON 表达式，label 只用于面板展示。 */
export interface WeekOption {
  value: string;
  label: string;
}

/** 各时间单位在面板上的候选项清单，决定可勾选的取值范围。 */
export interface CronData {
  second: string[];
  minute: string[];
  hour: string[];
  day: string[];
  month: string[];
  week: WeekOption[];
  year: number[];
}

/** 生成从当前年份起 11 年的候选年份，让年份下拉不必随时间手工维护。 */
const getYear = (): number[] => {
  const v: number[] = [];
  const y = new Date().getFullYear();
  for (let i = 0; i < 11; i++) {
    v.push(y + i);
  }
  return v;
};

/** 面板的初始选中值：全部时间单位走 type 为 '0' 的任意模式，只有星期预选工作日区间。 */
export const CronValueDefault: CronValue = {
  second: {
    type: '0',
    range: {
      start: 1,
      end: 2,
    },
    loop: {
      start: 0,
      end: 1,
    },
    appoint: [],
  },
  minute: {
    type: '0',
    range: {
      start: 1,
      end: 2,
    },
    loop: {
      start: 0,
      end: 1,
    },
    appoint: [],
  },
  hour: {
    type: '0',
    range: {
      start: 1,
      end: 2,
    },
    loop: {
      start: 0,
      end: 1,
    },
    appoint: [],
  },
  day: {
    type: '0',
    range: {
      start: 1,
      end: 2,
    },
    loop: {
      start: 1,
      end: 1,
    },
    appoint: [],
  },
  month: {
    type: '0',
    range: {
      start: 1,
      end: 2,
    },
    loop: {
      start: 1,
      end: 1,
    },
    appoint: [],
  },
  week: {
    type: '5',
    range: {
      start: '2',
      end: '3',
    },
    loop: {
      start: 0,
      end: '2',
    },
    last: '2',
    appoint: [],
  },
  year: {
    type: '-1',
    range: {
      start: getYear()[0],
      end: getYear()[1],
    },
    loop: {
      start: getYear()[0],
      end: 1,
    },
    appoint: [],
  },
};

/**
 * 各时间单位在面板上默认高亮的候选项。
 * 秒和分钟给常用步长，月份给 1-12，星期给中文标签，年份由当前年份起算 11 年。
 */
export const CronDataDefault: CronData = {
  second: [
    '0',
    '5',
    '15',
    '20',
    '25',
    '30',
    '35',
    '40',
    '45',
    '50',
    '55',
    '59',
  ],
  minute: [
    '0',
    '5',
    '15',
    '20',
    '25',
    '30',
    '35',
    '40',
    '45',
    '50',
    '55',
    '59',
  ],
  hour: [
    '0',
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
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
    '23',
  ],
  day: [
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
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
    '28',
    '29',
    '30',
    '31',
  ],
  month: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  week: [
    {
      value: '1',
      label: '周日',
    },
    {
      value: '2',
      label: '周一',
    },
    {
      value: '3',
      label: '周二',
    },
    {
      value: '4',
      label: '周三',
    },
    {
      value: '5',
      label: '周四',
    },
    {
      value: '6',
      label: '周五',
    },
    {
      value: '7',
      label: '周六',
    },
  ],
  year: getYear(),
};

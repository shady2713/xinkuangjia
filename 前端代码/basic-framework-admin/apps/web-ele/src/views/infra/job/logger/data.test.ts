/**
 * 定时任务日志元数据（views/infra/job/logger/data）真实行为回归。
 *
 * 该模块向任务日志页提供搜索表单、表格列与详情描述项：搜索项字段名写错会让筛选条件
 * 发不出去；时间选择器缺少绑定格式或默认时刻会让后端收到无法解析的时间串、用户选不到
 * 当天边界；任务状态下拉必须走数值型字典，否则后端收到字符串枚举值会判定为非法；
 * 执行时间列的区间格式写错会让用户分不清开始与结束时刻；执行时长列缺少单位会让用户
 * 读到裸数字；详情页的任务状态必须渲染成字典标签，否则用户看到的是裸枚举值；时长缺失
 * 时仍拼单位会输出 "undefined 毫秒"。用例使用真实字典缓存、真实格式化函数与真实时间
 * 取值函数，只替换 pinia 活动实例。
 */
import type { VNode } from 'vue';

import { DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import dayjs from 'dayjs';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { DictTag } from '#/components/dict-tag';

import { useDetailSchema, useGridColumns, useGridFormSchema } from './data';

/** 任务日志搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['handlerName', 'beginTime', 'endTime', 'status'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  'id',
  'jobId',
  'handlerName',
  'handlerParam',
  'executeIndex',
  'beginTime',
  'duration',
  'status',
  undefined,
];

/** 详情描述项的字段顺序，与详情弹窗的展示顺序一致。 */
const DETAIL_FIELDS = [
  'id',
  'jobId',
  'handlerName',
  'handlerParam',
  'executeIndex',
  'beginTime',
  'duration',
  'status',
  'result',
];

/**
 * 播种任务状态字典缓存，使真实字典取值函数返回数值型选项；直接写入当前活动的字典缓存。
 */
function seedJobLogStatusDict() {
  useDictStore().setDictCache({
    [DICT_TYPE.INFRA_JOB_LOG_STATUS]: [
      { label: '成功', value: '1' },
      { label: '失败', value: '2' },
    ],
  });
}

beforeEach(
  /** 每例重建字典缓存，避免上一例写入的字典影响本例断言。 */ () => {
    setActivePinia(createPinia());
    seedJobLogStatusDict();
  },
);

/**
 * 把表单字段的组件属性收窄为可按键读取的记录视图。
 * @param item 表单字段定义或空值。
 * @returns 组件属性记录；字段未声明属性时返回空对象。
 */
function componentProps(item: unknown) {
  const props = (item as undefined | { componentProps?: unknown })
    ?.componentProps;
  return (props ?? {}) as Record<string, unknown>;
}

/**
 * 按业务字段取出搜索项。
 * @param field 搜索项字段名。
 * @returns 命中的搜索项定义。
 * @throws Error 找不到该搜索项时抛出，避免用例静默地什么都不验证。
 */
function findSearchItem(field: string) {
  const item = useGridFormSchema().find(
    /** 只挑出目标字段的搜索项，其余项与本断言无关。 */ (entry) =>
      entry.fieldName === field,
  );
  if (!item) {
    throw new Error(`搜索表单缺少字段：${field}`);
  }
  return item;
}

/**
 * 取出列表列定义。
 * @returns 列定义数组。
 * @throws TypeError 列定义未返回时抛出，避免用例静默地什么都不验证。
 */
function gridColumns() {
  const columns = useGridColumns();
  if (!columns) {
    throw new TypeError('列定义未返回');
  }
  return columns;
}

/**
 * 按业务字段取出表格列。
 * @param field 列的 field 值。
 * @returns 命中的列定义。
 * @throws Error 找不到该列时抛出，避免用例静默地什么都不验证。
 */
function findColumn(field: string) {
  const column = gridColumns().find(
    /** 只挑出目标业务字段的列，其余列与本断言无关。 */ (entry) =>
      entry.field === field,
  );
  if (!column) {
    throw new Error(`列定义缺少字段：${field}`);
  }
  return column;
}

/**
 * 取出表格列的格式化函数。
 * @param field 列的 field 值。
 * @returns 该列的格式化函数。
 * @throws TypeError 该列缺少格式化函数时抛出，避免用例静默地什么都不验证。
 */
function requireFormatter(field: string) {
  const formatter = findColumn(field).formatter;
  if (typeof formatter !== 'function') {
    throw new TypeError(`列定义缺少格式化函数：${field}`);
  }
  return formatter;
}

/**
 * 构造 vxe-table 单元格格式化参数；被测格式化函数只读取行数据，其余字段由库在真实渲染时提供。
 * @param row 当前行的原始数据。
 * @returns 可供列格式化函数调用的参数对象。
 */
function formatterParams(row: Record<string, unknown>) {
  return { row } as never;
}

/**
 * 按业务字段取出详情描述项。
 * @param field 目标描述项的业务字段名。
 * @returns 命中的描述项。
 * @throws Error 找不到该描述项时抛出，避免用例静默地什么都不验证。
 */
function findDetailItem(field: string) {
  const item = useDetailSchema().find(
    /** 只挑出目标字段的描述项，其余项与本断言无关。 */ (entry) =>
      entry.field === field,
  );
  if (!item) {
    throw new Error(`详情描述项缺少字段：${field}`);
  }
  return item;
}

/**
 * 取出描述项的渲染函数。
 * @param field 目标描述项的业务字段名。
 * @returns 该描述项的渲染函数。
 * @throws TypeError 该描述项缺少渲染函数时抛出，避免用例静默地什么都不验证。
 */
function requireRender(field: string) {
  const render = findDetailItem(field).render;
  if (typeof render !== 'function') {
    throw new TypeError(`描述项缺少渲染函数：${field}`);
  }
  return render;
}

describe('任务日志搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明搜索项', /** 字段名或顺序写错会让筛选条件落到错误字段。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出字段名用于核对搜索项顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('处理器名字搜索项可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    expect(findSearchItem('handlerName')).toMatchObject({
      component: 'Input',
      label: '处理器的名字',
    });
    expect(componentProps(findSearchItem('handlerName'))).toEqual({
      clearable: true,
      placeholder: '请输入处理器的名字',
    });
  });

  it('开始与结束时间选择器绑定统一格式并给出边界默认时刻', /** 缺少默认时刻会让用户选不到当天零点与最后一秒。 */ () => {
    const begin = componentProps(findSearchItem('beginTime'));
    const end = componentProps(findSearchItem('endTime'));

    expect(findSearchItem('beginTime')).toMatchObject({
      component: 'DatePicker',
      label: '开始执行时间',
    });
    expect(begin.clearable).toBe(true);
    expect(begin.placeholder).toBe('选择开始执行时间');
    expect(begin.valueFormat).toBe('YYYY-MM-DD HH:mm:ss');
    expect(begin.class).toBe('!w-full');
    expect(
      (begin.showTime as { defaultValue?: unknown; format?: string }).format,
    ).toBe('HH:mm:ss');
    expect(
      dayjs(
        (begin.showTime as { defaultValue?: unknown }).defaultValue as never,
      ).format('HH:mm:ss'),
    ).toBe('00:00:00');

    expect(end.placeholder).toBe('选择结束执行时间');
    expect(end.valueFormat).toBe('YYYY-MM-DD HH:mm:ss');
    expect(
      dayjs(
        (end.showTime as { defaultValue?: unknown }).defaultValue as never,
      ).format('HH:mm:ss'),
    ).toBe('23:59:59');
  });

  it('任务状态下拉使用数值型字典选项', /** 字符串枚举值会被后端判定为非法。 */ () => {
    const status = findSearchItem('status');
    const props = componentProps(status);

    expect(status).toMatchObject({ component: 'Select', label: '任务状态' });
    expect(props.clearable).toBe(true);
    expect(props.placeholder).toBe('请选择任务状态');
    expect(props.options).toEqual([
      { label: '成功', value: 1 },
      { label: '失败', value: 2 },
    ]);
  });
});

describe('任务日志列定义', /** 列定义决定用户看到的字段、宽度与格式化结果。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('执行时间列把起止时刻拼成区间', /** 区间格式写错会让用户分不清开始与结束时刻。 */ () => {
    const formatter = requireFormatter('beginTime');

    expect(
      formatter(
        formatterParams({
          beginTime: '2026-03-04 05:06:07',
          endTime: '2026-03-04 06:07:08',
        }),
      ),
    ).toBe('2026-03-04 05:06:07 ~ 2026-03-04 06:07:08');
  });

  it('执行时间缺失时区间仍保留分隔符', /** 直接拼接 undefined 会输出不可读文本。 */ () => {
    const formatter = requireFormatter('beginTime');

    expect(formatter(formatterParams({}))).toBe(' ~ ');
  });

  it('执行时长列补上毫秒单位', /** 裸数字会让用户不知道单位。 */ () => {
    const formatter = requireFormatter('duration');

    expect(formatter(formatterParams({ duration: 1234 }))).toBe('1234 毫秒');
  });

  it('任务状态列交给字典单元格渲染器', /** 走文本渲染会让用户看到裸枚举值。 */ () => {
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_JOB_LOG_STATUS },
      },
      minWidth: 100,
      title: '任务状态',
    });
  });

  it('操作列固定在最右并由页面插槽渲染', /** 不固定会让操作列随横向滚动消失，插槽名写错会渲染成空白。 */ () => {
    const actions = gridColumns().at(-1);

    expect(actions).toMatchObject({ fixed: 'right', title: '操作', width: 80 });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });
});

describe('任务日志详情描述项', /** 详情渲染决定用户能否读懂执行区间、时长与状态。 */ () => {
  it('按约定顺序声明详情字段', /** 漏项会让详情缺少关键信息。 */ () => {
    expect(
      useDetailSchema().map(
        /** 取出详情字段名用于核对顺序。 */ (item) => item.field,
      ),
    ).toEqual(DETAIL_FIELDS);
  });

  it('执行时间在有结束时刻时拼成区间，否则输出空串', /** 只有开始时刻就显示区间会让用户以为任务已经结束。 */ () => {
    const render = requireRender('beginTime');

    expect(
      render('2026-03-04 05:06:07', { endTime: '2026-03-04 06:07:08' }),
    ).toBe('2026-03-04 05:06:07 ~ 2026-03-04 06:07:08');
    expect(render('2026-03-04 05:06:07', {})).toBe('');
    expect(render(undefined, { endTime: '2026-03-04 06:07:08' })).toBe('');
  });

  it('执行时长只在为有效数字时带单位输出', /** 非数字或 0 时拼单位会输出 "undefined 毫秒" 或误导性的 0 毫秒。 */ () => {
    const render = requireRender('duration');

    expect(render(1234)).toBe('1234 毫秒');
    expect(render('1234')).toBe('');
    expect(render(0)).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('任务状态渲染为带字典类型的标签节点', /** 渲染成纯文本会让用户看到裸枚举值。 */ () => {
    const node: VNode = requireRender('status')(2) as VNode;

    expect(node.type).toBe(DictTag);
    expect(node.props).toMatchObject({
      type: DICT_TYPE.INFRA_JOB_LOG_STATUS,
      value: 2,
    });
  });
});

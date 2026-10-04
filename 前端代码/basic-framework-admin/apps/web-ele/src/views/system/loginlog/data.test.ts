/**
 * 登录日志列表与详情元数据（views/system/loginlog/data）真实行为回归。
 *
 * 该模块向登录日志页提供搜索表单、表格列与详情描述项：搜索项字段名写错会让筛选条件
 * 发不出去，时间范围缺少默认属性会让用户拿到格式不符的时间串；登录类型与登录结果列
 * 必须走字典渲染器，否则用户看到的是裸枚举值；详情页的渲染函数必须产出真实的 DictTag
 * 节点，否则详情会退化成纯文本；登录时间缺少格式化会让详情显示原始时间戳。用例使用
 * 真实字典标签组件、真实格式化函数与真实时间范围属性，只替换翻译边界。
 */
import type { VNode } from 'vue';

import { DICT_TYPE } from '@vben/constants';

import dayjs from 'dayjs';
import { describe, expect, it, vi } from 'vitest';

import { DictTag } from '#/components/dict-tag';

import { useDetailSchema, useGridColumns, useGridFormSchema } from './data';

vi.mock(
  '#/locales',
  /** 只替换翻译边界，时间范围属性与快捷时间计算保持真实实现。 */ () => ({
    /**
     * 把语言键回显成可预期的译文。
     * @param key 组件请求的语言键。
     * @returns 带前缀的译文。
     */
    $t: (key: string) => `译文:${key}`,
  }),
);

/** 登录日志搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['username', 'userIp', 'createTime'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  'id',
  'logType',
  'username',
  'userIp',
  'userAgent',
  'result',
  'createTime',
  undefined,
];

/** 详情描述项的字段顺序，与详情弹窗的展示顺序一致。 */
const DETAIL_FIELDS = [
  'id',
  'logType',
  'username',
  'userIp',
  'userAgent',
  'result',
  'createTime',
];

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
 * 取出表格列定义中的指定列。
 * @param field 目标列的业务字段名。
 * @returns 命中的列定义；没有该字段时返回 undefined。
 */
function findColumn(field: string) {
  return gridColumns().find(
    /** 只挑出目标字段的列，其余列与本断言无关。 */ (item) =>
      (item as { field?: string }).field === field,
  );
}

/**
 * 取出详情描述项中的指定项。
 * @param field 目标描述项的业务字段名。
 * @returns 命中的描述项；没有该字段时返回 undefined。
 */
function findDetailItem(field: string) {
  return useDetailSchema().find(
    /** 只挑出目标字段的描述项，其余项与本断言无关。 */ (item) =>
      item.field === field,
  );
}

describe('登录日志搜索表单', /** 搜索项决定筛选条件能否正确发给后端。 */ () => {
  it('按约定顺序提供用户名称、登录地址与登录时间', /** 字段名或顺序写错会让筛选条件发不出去或落到错误字段。 */ () => {
    const schema = useGridFormSchema();

    expect(
      schema.map(
        /** 取出字段名用于核对搜索项顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
    expect(schema[0]).toMatchObject({
      component: 'Input',
      label: '用户名称',
      componentProps: { clearable: true, placeholder: '请输入用户名称' },
    });
    expect(schema[1]).toMatchObject({
      component: 'Input',
      label: '登录地址',
      componentProps: { clearable: true, placeholder: '请输入登录地址' },
    });
  });

  it('登录时间使用带默认属性的时间范围选择器', /** 缺少绑定格式会让后端收到无法解析的时间串。 */ () => {
    const schema = useGridFormSchema();
    const createTime = schema.find(
      /** 只挑出登录时间项，其余项与本断言无关。 */ (item) =>
        item.fieldName === 'createTime',
    );

    expect(createTime).toMatchObject({
      component: 'RangePicker',
      label: '登录时间',
      componentProps: { clearable: true },
    });
    const props = componentProps(createTime);
    expect(props.format).toBe('YYYY-MM-DD HH:mm:ss');
    expect(props.valueFormat).toBe('YYYY-MM-DD HH:mm:ss');
    expect(props.startPlaceholder).toBe('译文:utils.rangePicker.beginTime');
    expect(Array.isArray(props.shortcuts)).toBe(true);
    expect((props.shortcuts as unknown[]).length).toBeGreaterThan(0);
  });

  it('时间范围选择器保留可清空能力', /** 清空按钮丢失会让用户无法撤销时间筛选。 */ () => {
    const schema = useGridFormSchema();
    const createTime = schema.find(
      /** 只挑出登录时间项，其余项与本断言无关。 */ (item) =>
        item.fieldName === 'createTime',
    );

    expect(componentProps(createTime).clearable).toBe(true);
  });
});

describe('登录日志列定义', /** 列定义决定日志信息能否完整、可读地展示。 */ () => {
  it('列顺序与业务字段保持一致', /** 列顺序变化会让用户按习惯找到的信息错位。 */ () => {
    expect(
      gridColumns().map(
        /** 取出字段名用于核对列顺序；操作列没有字段名。 */
        (item) => (item as { field?: string }).field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('登录类型与登录结果列交由字典渲染器展示', /** 直接展示裸枚举值会让用户看到数字而不是类型名称。 */ () => {
    expect(findColumn('logType')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_LOGIN_TYPE },
      },
      minWidth: 120,
      title: '登录类型',
    });
    expect(findColumn('result')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_LOGIN_RESULT },
      },
      minWidth: 120,
      title: '登录结果',
    });
  });

  it('登录日期列使用统一的时间格式化器', /** 缺少格式化会让用户看到原始时间戳或 ISO 串。 */ () => {
    expect(findColumn('createTime')).toMatchObject({
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '登录日期',
    });
  });

  it('日志编号、用户名称、登录地址与浏览器列给出最小宽度', /** 宽度缺失会让窄屏下的列被压缩到不可读。 */ () => {
    expect(findColumn('id')).toMatchObject({
      minWidth: 100,
      title: '日志编号',
    });
    expect(findColumn('username')).toMatchObject({
      minWidth: 180,
      title: '用户名称',
    });
    expect(findColumn('userIp')).toMatchObject({
      minWidth: 180,
      title: '登录地址',
    });
    expect(findColumn('userAgent')).toMatchObject({
      minWidth: 200,
      title: '浏览器',
    });
  });

  it('操作列固定在右侧并挂载操作插槽', /** 操作列不固定会被横向滚动带走，插槽名写错会让操作按钮不显示。 */ () => {
    expect(gridColumns().at(-1)).toMatchObject({
      fixed: 'right',
      slots: { default: 'actions' },
      width: 120,
    });
  });
});

describe('登录日志详情描述项', /** 详情描述项决定详情弹窗展示哪些字段与渲染方式。 */ () => {
  it('按约定顺序提供全部详情字段', /** 字段缺失会让详情页看不到关键登录信息。 */ () => {
    expect(
      useDetailSchema().map(
        /** 取出字段名用于核对详情项顺序。 */ (item) => item.field,
      ),
    ).toEqual(DETAIL_FIELDS);
  });

  it('纯文本字段不声明渲染函数', /** 多写渲染函数会让纯文本字段被渲染成组件而丢失内容。 */ () => {
    for (const field of ['id', 'username', 'userIp', 'userAgent']) {
      expect(findDetailItem(field)?.render).toBeUndefined();
    }
  });

  it('登录类型渲染为带字典类型的标签节点', /** 渲染成纯文本会让用户看到裸枚举值。 */ () => {
    const render = findDetailItem('logType')?.render;
    if (typeof render !== 'function') {
      throw new TypeError('登录类型描述项缺少渲染函数');
    }

    const node: VNode = render(2) as VNode;

    expect(node.type).toBe(DictTag);
    expect(node.props).toMatchObject({
      type: DICT_TYPE.SYSTEM_LOGIN_TYPE,
      value: 2,
    });
  });

  it('登录结果渲染为带字典类型的标签节点', /** 成功与失败需要用颜色区分，纯文本无法区分。 */ () => {
    const render = findDetailItem('result')?.render;
    if (typeof render !== 'function') {
      throw new TypeError('登录结果描述项缺少渲染函数');
    }

    const node: VNode = render(true) as VNode;

    expect(node.type).toBe(DictTag);
    expect(node.props).toMatchObject({
      type: DICT_TYPE.SYSTEM_LOGIN_RESULT,
      value: true,
    });
  });

  it('登录时间按统一格式渲染并兜底空值', /** 未格式化会显示原始时间戳，空值不兜底会渲染成 undefined 文本。 */ () => {
    const render = findDetailItem('createTime')?.render;
    if (typeof render !== 'function') {
      throw new TypeError('登录日期描述项缺少渲染函数');
    }
    const moment = new Date('2026-03-04T05:06:07Z');

    expect(render(moment)).toBe(dayjs(moment).format('YYYY-MM-DD HH:mm:ss'));
    expect(render(undefined)).toBe('');
  });
});

/**
 * 文件管理列表元数据（views/infra/file/data）真实行为回归。
 *
 * 该模块向文件上传弹窗与文件列表页提供表单与列定义：上传字段名写错会让弹窗提交的
 * 表单值拿不到文件；搜索项字段名写错会让筛选条件发不出去；上传时间列缺少时间范围
 * 默认属性会让后端收到格式不符的时间串；文件大小与上传时间列缺少格式化会让用户
 * 看到裸字节数与时间戳；文件内容与操作列缺少插槽名会让页面渲染出空白列。用例使用
 * 真实的时间范围属性，只替换翻译边界。
 */
import { describe, expect, it, vi } from 'vitest';

import { getRangePickerDefaultProps } from '#/utils';

import { useFormSchema, useGridColumns, useGridFormSchema } from './data';

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

/** 文件列表搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['path', 'type', 'createTime'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'name',
  'path',
  'url',
  'size',
  'type',
  'file-content',
  'createTime',
  undefined,
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
 * 按业务字段取出表格列定义。
 * @param field 列的 field 值。
 * @returns 命中的列定义。
 * @throws Error 找不到该列时抛出，避免用例静默地什么都不验证。
 */
function findColumn(field: string) {
  const column = gridColumns().find(
    /** 只挑出目标业务字段的列，其余列与本断言无关。 */ (item) =>
      item.field === field,
  );
  if (!column) {
    throw new Error(`列定义缺少字段：${field}`);
  }
  return column;
}

describe('文件上传表单', /** 上传字段名与校验决定弹窗能否提交所选文件。 */ () => {
  it('只声明一个必填的文件上传字段', /** 字段名写错会让弹窗提交时拿不到文件，漏掉必填会让空提交通过。 */ () => {
    const rows = useFormSchema();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      component: 'Upload',
      fieldName: 'file',
      label: '文件上传',
      rules: 'required',
    });
    expect(componentProps(rows[0]).placeholder).toBe('请选择要上传的文件');
  });
});

describe('文件列表搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明路径、类型与创建时间筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    const rows = useGridFormSchema();

    expect(
      rows.map(/** 取出筛选字段名用于核对顺序。 */ (row) => row.fieldName),
    ).toEqual(SEARCH_FIELDS);
  });

  it('文本筛选可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const rows = useGridFormSchema();
    const path = rows[0];
    const type = rows[1];

    expect(path).toMatchObject({ component: 'Input', label: '文件路径' });
    expect(componentProps(path)).toEqual({
      clearable: true,
      placeholder: '请输入文件路径',
    });
    expect(type).toMatchObject({ component: 'Input', label: '文件类型' });
    expect(componentProps(type)).toEqual({
      clearable: true,
      placeholder: '请输入文件类型',
    });
  });

  it('创建时间沿用真实时间范围属性并允许清空', /** 缺少值格式会让后端收到非约定格式的时间串。 */ () => {
    const rows = useGridFormSchema();
    const createTime = rows[2];
    const defaults = getRangePickerDefaultProps();
    const props = componentProps(createTime);

    expect(createTime).toMatchObject({
      component: 'RangePicker',
      label: '创建时间',
    });
    expect(props.clearable).toBe(true);
    expect(props.format).toBe(defaults.format);
    expect(props.valueFormat).toBe(defaults.valueFormat);
    expect(props.startPlaceholder).toBe('译文:utils.rangePicker.beginTime');
    expect(props.endPlaceholder).toBe('译文:utils.rangePicker.endTime');
    expect(props.defaultTime).toHaveLength(2);
    expect(props.shortcuts).toHaveLength(defaults.shortcuts.length);
  });
});

describe('文件列表列定义', /** 列定义决定用户看到的字段、宽度与格式化结果。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('首列是复选框且操作列固定在最右', /** 缺少复选框列会让用户无法批量选择，操作列不固定会随横向滚动消失。 */ () => {
    const columns = gridColumns();
    const actions = columns.at(-1);

    expect(columns[0]).toMatchObject({ type: 'checkbox', width: 40 });
    expect(actions).toMatchObject({
      fixed: 'right',
      title: '操作',
      width: 160,
    });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });

  it('文件名与路径列给出可读宽度并允许溢出省略', /** 路径过长会撑破表格，缺少省略会让列宽失控。 */ () => {
    expect(findColumn('name')).toMatchObject({
      minWidth: 150,
      title: '文件名',
    });
    expect(findColumn('path')).toMatchObject({
      minWidth: 200,
      showOverflow: true,
      title: '文件路径',
    });
    expect(findColumn('url')).toMatchObject({
      minWidth: 200,
      showOverflow: true,
      title: 'URL',
    });
  });

  it('大小与上传时间列挂载真实格式化器', /** 缺少格式化会让用户看到裸字节数与时间戳。 */ () => {
    expect(findColumn('size')).toMatchObject({
      formatter: 'formatFileSize',
      minWidth: 80,
      title: '文件大小',
    });
    expect(findColumn('createTime')).toMatchObject({
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '上传时间',
    });
  });

  it('文件内容列由页面插槽渲染', /** 插槽名写错会让文件内容列渲染成空白。 */ () => {
    expect(findColumn('file-content')).toMatchObject({
      minWidth: 120,
      title: '文件内容',
    });
    expect(findColumn('file-content').slots).toEqual({
      default: 'file-content',
    });
  });
});

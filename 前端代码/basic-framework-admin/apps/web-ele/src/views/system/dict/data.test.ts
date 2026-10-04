/**
 * 字典元数据（views/system/dict/data）真实行为回归。
 *
 * 该模块向字典类型与字典数据两组页面提供字段与列定义：字典类型字段在编辑时未置灰会
 * 让用户改坏已有类型标识；字典数据的类型下拉未绑定字典类型接口会让用户选不到类型；
 * 颜色类型候选项缺失会让用户无法给字典标签着色；状态列缺少字典单元格会让列表显示
 * 原始字典值；创建时间列缺少格式化会让用户看到时间戳。
 *
 * 用例真实调用每个导出函数，并真实执行返回结构里的每个联动函数与接口属性，只替换
 * 字典类型接口与字典缓存边界。
 */
import type { VbenFormSchema } from '#/adapter/form';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSimpleDictTypeList } from '#/api/system/dict/type';

import {
  useDataFormSchema,
  useDataGridColumns,
  useDataGridFormSchema,
  useTypeFormSchema,
  useTypeGridColumns,
  useTypeGridFormSchema,
} from './data';

/** 字典类型表单的字段顺序，决定类型弹窗的录入顺序。 */
const TYPE_FORM_FIELDS = ['id', 'name', 'type', 'status', 'remark'];

/** 字典类型搜索项的字段顺序，与后端分页入参约定一致。 */
const TYPE_SEARCH_FIELDS = ['name', 'type', 'status'];

/** 字典类型列的字段顺序，决定用户从左到右看到的列。 */
const TYPE_COLUMN_FIELDS = [
  undefined,
  'id',
  'name',
  'type',
  'status',
  'remark',
  'createTime',
  undefined,
];

/** 字典数据表单的字段顺序，决定数据弹窗的录入顺序。 */
const DATA_FORM_FIELDS = [
  'id',
  'dictType',
  'label',
  'value',
  'sort',
  'status',
  'colorType',
  'cssClass',
  'remark',
];

/** 字典数据搜索项的字段顺序，与后端分页入参约定一致。 */
const DATA_SEARCH_FIELDS = ['label', 'status'];

/** 字典数据列的字段顺序，决定用户从左到右看到的列。 */
const DATA_COLUMN_FIELDS = [
  undefined,
  'id',
  'label',
  'value',
  'sort',
  'status',
  'colorType',
  'cssClass',
  'createTime',
  undefined,
];

/** 颜色类型候选项：与页面下拉一一对应，供用例核对取值口径。 */
const COLOR_OPTIONS = [
  { label: '无', value: '' },
  { label: '主要', value: 'processing' },
  { label: '成功', value: 'success' },
  { label: '默认', value: 'default' },
  { label: '警告', value: 'warning' },
  { label: '危险', value: 'error' },
  { label: 'pink', value: 'pink' },
  { label: 'red', value: 'red' },
  { label: 'orange', value: 'orange' },
  { label: 'green', value: 'green' },
  { label: 'cyan', value: 'cyan' },
  { label: 'blue', value: 'blue' },
  { label: 'purple', value: 'purple' },
];

vi.mock(
  '#/api/system/dict/type',
  /** 只替换字典类型接口边界，字典数据表单的属性装配保持真实实现。 */ () => ({
    getSimpleDictTypeList: vi.fn(),
  }),
);

/** 字段显示条件：按当前表单值判断字段是否渲染。 */
type ShowPredicate = (values: Record<string, unknown>) => boolean;

/** 字段属性联动函数：按当前表单值返回要合并进组件属性的部分。 */
type ComponentPropsResolver = (
  values: Record<string, unknown>,
) => Record<string, unknown>;

/** 字段依赖配置：声明触发重新计算的字段与显示条件。 */
interface FieldDependencies {
  /** 判断字段当前是否显示；返回 false 时字段被隐藏。 */
  show?: ShowPredicate;
  /** 触发重新计算的字段名列表，空串表示任意字段变化。 */
  triggerFields?: string[];
}

/** 字典类型接口替身签名：返回简化字典类型列表。 */
type DictTypeApi = () => Promise<unknown>;

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
 * 取出表单字段声明的属性联动函数。
 * @param item 表单字段定义。
 * @returns 属性联动函数。
 * @throws TypeError 字段未声明函数式属性时抛出，避免用例静默地什么都不验证。
 */
function propsResolver(item: unknown) {
  const resolve = (item as undefined | { componentProps?: unknown })
    ?.componentProps;
  if (typeof resolve !== 'function') {
    throw new TypeError('字段未声明函数式组件属性');
  }
  return resolve as ComponentPropsResolver;
}

/**
 * 取出表单字段的依赖配置。
 * @param item 表单字段定义。
 * @returns 依赖配置；字段未声明依赖时返回空对象。
 */
function fieldDependencies(item: unknown) {
  return ((item as undefined | { dependencies?: FieldDependencies })
    ?.dependencies ?? {}) as FieldDependencies;
}

/**
 * 取出组件属性里声明的接口函数。
 * @param props 组件属性记录。
 * @returns 声明在组件属性上的接口函数。
 * @throws TypeError 未声明接口函数时抛出，避免用例静默地什么都不验证。
 */
function requireApi(props: Record<string, unknown>) {
  const api = props.api;
  if (typeof api !== 'function') {
    throw new TypeError('组件属性未声明接口函数');
  }
  return api as DictTypeApi;
}

/**
 * 按字段名取出表单字段定义。
 * @param schema 表单字段定义数组。
 * @param fieldName 目标字段名。
 * @returns 命中的字段定义。
 * @throws Error 找不到该字段时抛出，避免用例静默地什么都不验证。
 */
function findField(schema: VbenFormSchema[], fieldName: string) {
  const field = schema.find(
    /** 只挑出目标业务字段，其余字段与本断言无关。 */ (item) =>
      item.fieldName === fieldName,
  );
  if (!field) {
    throw new Error(`表单缺少字段：${fieldName}`);
  }
  return field;
}

/**
 * 按业务字段取出表格列定义。
 * @param columns 列定义数组。
 * @param field 列的 field 值。
 * @returns 命中的列定义。
 * @throws Error 找不到该列时抛出，避免用例静默地什么都不验证。
 */
function requireColumns(columns: unknown) {
  if (!Array.isArray(columns)) {
    throw new TypeError('列定义未返回');
  }
  return columns as Array<{
    /** 列的字段名；操作列等占位列没有字段名。 */
    field?: string;
    /** 列上声明的插槽配置。 */
    slots?: Record<string, unknown>;
  }>;
}

/**
 * 按业务字段取出表格列定义。
 * @param columns 列定义数组或空值。
 * @param field 列的 field 值。
 * @returns 命中的列定义。
 * @throws TypeError 列定义未返回时抛出，避免用例静默地什么都不验证。
 * @throws Error 找不到该列时抛出，避免用例静默地什么都不验证。
 */
function findColumn(columns: unknown, field: string) {
  const column = requireColumns(columns).find(
    /** 只挑出目标业务字段的列，其余列与本断言无关。 */ (item) =>
      item.field === field,
  );
  if (!column) {
    throw new Error(`列定义缺少字段：${field}`);
  }
  return column;
}

beforeEach(
  /** 每例重建字典缓存与接口替身，让状态字典与类型接口走真实取值链路。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.COMMON_STATUS]: [
        { label: '开启', value: '0' },
        { label: '关闭', value: '1' },
      ],
    });
    vi.mocked(getSimpleDictTypeList).mockResolvedValue([
      { name: '通用状态', type: 'common_status' },
    ] as never);
  },
);

/** 校验规则最小契约：用例只读取默认值解析结果。 */
interface DefaultValueRule {
  /**
   * 解析取值并返回解析结果。
   * @param value 交给校验器解析的取值。
   * @returns 解析成功后的结果数据。
   */
  parse(value: unknown): unknown;
}

describe('字典类型表单字段', /** 字段与联动决定字典类型能否正确新增与修改。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让用户无法录入，顺序错乱会降低可读性。 */ () => {
    expect(
      useTypeFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(TYPE_FORM_FIELDS);
  });

  it('主键字段隐藏且声明空触发字段', /** 主键可见会让用户误改记录标识，缺少依赖配置会让隐藏失效。 */ () => {
    const id = findField(useTypeFormSchema(), 'id');
    const dependencies = fieldDependencies(id);

    expect(id.component).toBe('Input');
    expect(dependencies.triggerFields).toEqual(['']);
    expect(dependencies.show?.({})).toBe(false);
  });

  it('类型标识在编辑已有记录时置灰', /** 编辑时允许改类型标识会让已引用该类型的字典数据失去归属。 */ () => {
    const type = findField(useTypeFormSchema(), 'type');
    const resolve = propsResolver(type);

    expect(type).toMatchObject({
      component: 'Input',
      label: '字典类型',
      rules: 'required',
    });
    expect(fieldDependencies(type).triggerFields).toEqual(['']);
    expect(resolve({})).toEqual({
      disabled: false,
      placeholder: '请输入字典类型',
    });
    expect(resolve({ id: 9 })).toEqual({
      disabled: true,
      placeholder: '请输入字典类型',
    });
  });

  it('状态取自状态字典并默认启用', /** 字典类型写错会让状态选项为空，默认值写错会让新类型默认停用。 */ () => {
    const status = findField(useTypeFormSchema(), 'status');

    expect(status).toMatchObject({ component: 'RadioGroup', label: '状态' });
    expect(componentProps(status).options).toEqual([
      { label: '开启', value: 0 },
      { label: '关闭', value: 1 },
    ]);
    const rule = status.rules as DefaultValueRule;
    expect(rule.parse(undefined)).toBe(CommonStatusEnum.ENABLE);
  });
});

describe('字典类型搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明名称、类型与状态筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useTypeGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (row) => row.fieldName,
      ),
    ).toEqual(TYPE_SEARCH_FIELDS);
  });

  it('名称与类型可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const schema = useTypeGridFormSchema();

    expect(componentProps(findField(schema, 'name'))).toEqual({
      clearable: true,
      placeholder: '请输入字典名称',
    });
    expect(componentProps(findField(schema, 'type'))).toEqual({
      clearable: true,
      placeholder: '请输入字典类型',
    });
  });

  it('状态筛选取自状态字典且可清空', /** 字典类型写错会让筛选下拉为空。 */ () => {
    const status = findField(useTypeGridFormSchema(), 'status');

    expect(status).toMatchObject({ component: 'Select', label: '状态' });
    expect(componentProps(status)).toEqual({
      clearable: true,
      options: [
        { label: '开启', value: 0 },
        { label: '关闭', value: 1 },
      ],
      placeholder: '请选择状态',
    });
  });
});

describe('字典类型列定义', /** 列定义决定用户看到的字段与字典展示。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      requireColumns(useTypeGridColumns()).map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(TYPE_COLUMN_FIELDS);
  });

  it('状态列挂载状态字典单元格', /** 字典类型写错会让状态列显示原始字典值。 */ () => {
    const columns = useTypeGridColumns();

    expect(findColumn(columns, 'status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      minWidth: 120,
      title: '状态',
    });
  });

  it('创建时间列挂载真实格式化器且操作列固定在最右', /** 缺少格式化会让用户看到时间戳，操作列不固定会随横向滚动消失。 */ () => {
    const columns = requireColumns(useTypeGridColumns());
    const actions = columns.at(-1);

    expect(findColumn(columns, 'createTime')).toMatchObject({
      formatter: 'formatDateTime',
      title: '创建时间',
    });
    expect(actions).toMatchObject({
      fixed: 'right',
      title: '操作',
      minWidth: 120,
    });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });
});

describe('字典数据表单字段', /** 字段与联动决定字典数据能否正确新增与修改。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让用户无法录入，顺序错乱会降低可读性。 */ () => {
    expect(
      useDataFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(DATA_FORM_FIELDS);
  });

  it('主键字段隐藏', /** 主键可见会让用户误改记录标识。 */ () => {
    const id = findField(useDataFormSchema(), 'id');

    expect(id.component).toBe('Input');
    expect(fieldDependencies(id).show?.({})).toBe(false);
  });

  it('字典类型下拉绑定字典类型接口并在编辑时置灰', /** 未绑定接口会让用户选不到类型，编辑时未置灰会让数据换错归属类型。 */ async () => {
    const dictType = findField(useDataFormSchema(), 'dictType');
    const resolve = propsResolver(dictType);

    expect(dictType).toMatchObject({
      component: 'ApiSelect',
      label: '字典类型',
      rules: 'required',
    });
    expect(fieldDependencies(dictType).triggerFields).toEqual(['']);
    expect(resolve({})).toMatchObject({
      disabled: false,
      labelField: 'name',
      placeholder: '请输入字典类型',
      valueField: 'type',
    });
    expect(resolve({ id: 3 }).disabled).toBe(true);
    const api = requireApi(resolve({}));
    await expect(api()).resolves.toEqual([
      { name: '通用状态', type: 'common_status' },
    ]);
  });

  it('排序、标签与键值为必填', /** 缺少必填会让不完整字典数据落库。 */ () => {
    const schema = useDataFormSchema();

    for (const fieldName of ['label', 'value', 'sort']) {
      expect(findField(schema, fieldName).rules).toBe('required');
    }
    expect(componentProps(findField(schema, 'sort')).class).toBe('!w-full');
  });

  it('状态取自状态字典并默认启用', /** 字典类型写错会让状态选项为空。 */ () => {
    const status = findField(useDataFormSchema(), 'status');

    expect(componentProps(status)).toMatchObject({
      options: [
        { label: '开启', value: 0 },
        { label: '关闭', value: 1 },
      ],
      placeholder: '请选择状态',
    });
    const rule = status.rules as DefaultValueRule;
    expect(rule.parse(undefined)).toBe(CommonStatusEnum.ENABLE);
  });

  it('颜色类型给出完整候选项', /** 候选项缺失会让用户无法给字典标签着色。 */ () => {
    const colorType = findField(useDataFormSchema(), 'colorType');

    expect(colorType).toMatchObject({ component: 'Select', label: '颜色类型' });
    expect(componentProps(colorType)).toEqual({
      options: COLOR_OPTIONS,
      placeholder: '请选择颜色类型',
    });
  });

  it('cSS Class 字段给出 hex 模式说明', /** 缺少说明会让用户填出无效颜色值。 */ () => {
    const cssClass = findField(useDataFormSchema(), 'cssClass');

    expect(cssClass.help).toBe('输入 hex 模式的颜色, 例如 #108ee9');
    expect(componentProps(cssClass).placeholder).toBe('请输入 CSS Class');
  });
});

describe('字典数据搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明标签与状态筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useDataGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (row) => row.fieldName,
      ),
    ).toEqual(DATA_SEARCH_FIELDS);
  });

  it('标签筛选可清空且状态取自状态字典', /** 缺少可清空标记会让用户无法撤销筛选，字典类型写错会让下拉为空。 */ () => {
    const schema = useDataGridFormSchema();

    expect(componentProps(findField(schema, 'label'))).toEqual({
      clearable: true,
      placeholder: '请输入字典标签',
    });
    expect(componentProps(findField(schema, 'status'))).toMatchObject({
      clearable: true,
      options: [
        { label: '开启', value: 0 },
        { label: '关闭', value: 1 },
      ],
      placeholder: '请选择状态',
    });
  });
});

describe('字典数据列定义', /** 列定义决定用户看到的字段与字典展示。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      requireColumns(useDataGridColumns()).map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(DATA_COLUMN_FIELDS);
  });

  it('状态列挂载状态字典单元格且创建时间可格式化', /** 缺少字典单元格会显示原始字典值，缺少格式化会显示时间戳。 */ () => {
    const columns = useDataGridColumns();

    expect(findColumn(columns, 'status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      title: '状态',
    });
    expect(findColumn(columns, 'createTime')).toMatchObject({
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '创建时间',
    });
  });
});

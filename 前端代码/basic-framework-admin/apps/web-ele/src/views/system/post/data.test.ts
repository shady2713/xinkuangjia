/**
 * 岗位列表元数据（views/system/post/data）真实行为回归。
 *
 * 该模块向岗位表单与岗位列表提供字段定义：表单字段名写错会让提交值落到错误字段；
 * 岗位状态下拉必须按数值型字典渲染，否则后端收到字符串枚举会判定非法；隐藏的主键项
 * 缺少依赖配置会让新增表单带出主键；列定义缺少字典渲染器会让状态显示成裸数字，缺少
 * 时间格式化会让用户看到时间戳。用例使用真实字典缓存与真实字典取值函数，只写入当前
 * 活动的字典缓存，不替换被测模块的实现。
 */
import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useFormSchema, useGridColumns, useGridFormSchema } from './data';

/** 岗位表单的字段顺序，决定新增/修改弹窗的录入顺序。 */
const FORM_FIELDS = ['id', 'name', 'code', 'sort', 'status', 'remark'];

/** 岗位搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['name', 'code', 'status'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'id',
  'name',
  'code',
  'sort',
  'remark',
  'status',
  'createTime',
  undefined,
];

/** 表单字段依赖配置：声明触发重新计算的字段与显示条件。 */
interface FieldDependencies {
  /** 判断字段当前是否显示；返回 false 时字段被隐藏。 */
  show?: () => boolean;
  /** 触发重新计算的字段名列表，空串表示任意字段变化。 */
  triggerFields?: string[];
}

/** 校验规则最小契约：用例只读取默认值与首条错误信息。 */
interface ParseableRule {
  /**
   * 解析取值并返回解析结果。
   * @param value 交给校验器解析的取值。
   * @returns 解析成功后的结果数据。
   */
  parse(value: unknown): unknown;
  /**
   * 解析取值并返回判定结果。
   * @param value 交给校验器解析的取值。
   * @returns 成功时带解析数据，失败时带首条错误信息。
   */
  safeParse(
    value: unknown,
  ):
    | { data: unknown; success: true }
    | { error: { issues: Array<{ message: string }> }; success: false };
}

/**
 * 把表单字段声明的校验规则收窄为可驱动的校验器。
 * @param rule 字段声明的规则，可能是命名规则字符串或 zod 校验器。
 * @returns 可解析取值的校验器视图。
 * @throws TypeError 规则不是校验器时抛出，避免用例静默地什么都不验证。
 */
function parseableRule(rule: unknown): ParseableRule {
  if (rule === null || typeof rule !== 'object' || !('safeParse' in rule)) {
    throw new TypeError('字段未声明可解析的校验规则');
  }
  return rule as ParseableRule;
}

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
 * 按字段名取出表单字段定义。
 * @param fields 表单字段定义数组。
 * @param fieldName 目标字段名。
 * @returns 命中的字段定义。
 * @throws Error 找不到该字段时抛出，避免用例静默地什么都不验证。
 */
function findField(
  fields: ReturnType<typeof useFormSchema>,
  fieldName: string,
) {
  const field = fields.find(
    /** 只挑出目标业务字段，其余字段与本断言无关。 */ (item) =>
      item.fieldName === fieldName,
  );
  if (!field) {
    throw new Error(`表单缺少字段：${fieldName}`);
  }
  return field;
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

beforeEach(
  /** 每例重建字典缓存，避免上一例写入的字典影响本例断言。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.COMMON_STATUS]: [
        { label: '开启', value: '0' },
        { label: '关闭', value: '1' },
      ],
    });
  },
);

describe('岗位表单字段', /** 字段名与校验决定新增/修改岗位能否提交出正确数据。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让用户无法录入，顺序错乱会降低可读性。 */ () => {
    expect(
      useFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(FORM_FIELDS);
  });

  it('主键字段隐藏且声明空触发字段', /** 主键可见会让用户误改记录标识，缺少依赖配置会让隐藏失效。 */ () => {
    const id = findField(useFormSchema(), 'id');
    const dependencies = (
      id as {
        dependencies?: FieldDependencies;
      }
    ).dependencies;

    expect(id.component).toBe('Input');
    expect(dependencies?.triggerFields).toEqual(['']);
    expect(dependencies?.show?.()).toBe(false);
  });

  it('名称、编码与顺序为必填项', /** 漏必填会让无名称或无编码的岗位落库。 */ () => {
    const fields = useFormSchema();

    expect(findField(fields, 'name')).toMatchObject({
      component: 'Input',
      label: '岗位名称',
      rules: 'required',
    });
    expect(componentProps(findField(fields, 'name')).placeholder).toBe(
      '请输入岗位名称',
    );
    expect(findField(fields, 'code')).toMatchObject({
      component: 'Input',
      label: '岗位编码',
      rules: 'required',
    });
    expect(componentProps(findField(fields, 'code')).placeholder).toBe(
      '请输入岗位编码',
    );
    expect(findField(fields, 'sort')).toMatchObject({
      component: 'InputNumber',
      label: '显示顺序',
      rules: 'required',
    });
    expect(componentProps(findField(fields, 'sort'))).toMatchObject({
      class: '!w-full',
      controlsPosition: 'right',
      min: 0,
    });
  });

  it('岗位状态使用数值型字典并默认开启', /** 传字符串枚举会被后端判定为非法状态。 */ () => {
    const status = findField(useFormSchema(), 'status');

    expect(status).toMatchObject({
      component: 'RadioGroup',
      label: '岗位状态',
    });
    expect(componentProps(status).options).toEqual([
      { label: '开启', value: 0 },
      { label: '关闭', value: 1 },
    ]);
    // 未选择状态时按开启处理，与后端默认值一致。
    expect(parseableRule(status.rules).parse(undefined)).toBe(
      CommonStatusEnum.ENABLE,
    );
  });
});

describe('岗位搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明名称、编码与状态筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('文本筛选可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const schema = useGridFormSchema();

    expect(schema[0]).toMatchObject({ component: 'Input', label: '岗位名称' });
    expect(componentProps(schema[0])).toEqual({
      clearable: true,
      placeholder: '请输入岗位名称',
    });
    expect(schema[1]).toMatchObject({ component: 'Input', label: '岗位编码' });
    expect(componentProps(schema[1])).toEqual({
      clearable: true,
      placeholder: '请输入岗位编码',
    });
  });

  it('状态筛选使用数值型字典并允许清空', /** 字符串枚举会让筛选条件查不到数据。 */ () => {
    const status = useGridFormSchema()[2];

    expect(status).toMatchObject({ component: 'Select', label: '岗位状态' });
    expect(componentProps(status)).toEqual({
      clearable: true,
      options: [
        { label: '开启', value: 0 },
        { label: '关闭', value: 1 },
      ],
      placeholder: '请选择岗位状态',
    });
  });
});

describe('岗位列表列定义', /** 列定义决定用户看到的字段、宽度与格式化结果。 */ () => {
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
      width: 130,
    });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });

  it('状态列挂载字典渲染器', /** 缺少字典渲染会让用户看到裸数字而不是状态文案。 */ () => {
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      minWidth: 100,
      title: '岗位状态',
    });
  });

  it('创建时间列挂载时间格式化器', /** 缺少格式化会让用户看到时间戳。 */ () => {
    expect(findColumn('createTime')).toMatchObject({
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '创建时间',
    });
  });
});

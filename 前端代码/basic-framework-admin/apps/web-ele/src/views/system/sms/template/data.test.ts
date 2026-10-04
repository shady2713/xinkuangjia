/**
 * 短信模板列表元数据（views/system/sms/template/data）真实行为回归。
 *
 * 该模块向模板表单与模板列表提供字段定义：模板编号、渠道编号与内容字段名写错会让模板
 * 提交到错误字段；短信类型与开启状态必须按数值型字典渲染，否则后端收到字符串枚举会
 * 判定非法；模板内容列缺少宽度会让长模板撑破表格，时间列缺少格式化会让用户看到时间戳。
 * 用例使用真实字典缓存与真实字典取值函数，只写入当前活动的字典缓存，不替换被测模块。
 */
import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useFormSchema, useGridColumns, useGridFormSchema } from './data';

/** 模板表单的字段顺序，决定新增/修改弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'type',
  'status',
  'code',
  'name',
  'apiTemplateId',
  'channelId',
  'content',
  'remark',
];

/** 模板搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['code', 'type', 'status'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'id',
  'code',
  'name',
  'type',
  'status',
  'content',
  'apiTemplateId',
  'channelId',
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

/** 校验规则最小契约：用例只读取默认值。 */
interface ParseableRule {
  /**
   * 解析取值并返回解析结果。
   * @param value 交给校验器解析的取值。
   * @returns 解析成功后的结果数据。
   */
  parse(value: unknown): unknown;
}

/**
 * 把表单字段声明的校验规则收窄为可驱动的校验器。
 * @param rule 字段声明的规则，可能是命名规则字符串或 zod 校验器。
 * @returns 可解析取值的校验器视图。
 * @throws TypeError 规则不是校验器时抛出，避免用例静默地什么都不验证。
 */
function parseableRule(rule: unknown): ParseableRule {
  if (rule === null || typeof rule !== 'object' || !('parse' in rule)) {
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
 * @param fieldName 目标字段名。
 * @returns 命中的字段定义。
 * @throws Error 找不到该字段时抛出，避免用例静默地什么都不验证。
 */
function findField(fieldName: string) {
  const field = useFormSchema().find(
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
      [DICT_TYPE.SYSTEM_SMS_TEMPLATE_TYPE]: [
        { label: '验证码', value: '1' },
        { label: '通知', value: '2' },
      ],
    });
  },
);

describe('短信模板表单字段', /** 字段名与校验决定模板能否正确落库。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让用户无法录入，顺序错乱会降低可读性。 */ () => {
    expect(
      useFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(FORM_FIELDS);
  });

  it('主键字段隐藏且声明空触发字段', /** 主键可见会让用户误改记录标识，缺少依赖配置会让隐藏失效。 */ () => {
    const id = findField('id');
    const dependencies = (
      id as {
        dependencies?: FieldDependencies;
      }
    ).dependencies;

    expect(id.component).toBe('Input');
    expect(dependencies?.triggerFields).toEqual(['']);
    expect(dependencies?.show?.()).toBe(false);
  });

  it('短信类型使用数值型字典且必填', /** 传字符串枚举会让后端匹配不到短信类型。 */ () => {
    const type = findField('type');

    expect(type).toMatchObject({
      component: 'Select',
      label: '短信类型',
      rules: 'required',
    });
    expect(componentProps(type)).toEqual({
      options: [
        { label: '验证码', value: 1 },
        { label: '通知', value: 2 },
      ],
      placeholder: '请选择短信类型',
    });
  });

  it('开启状态使用数值型字典并默认开启', /** 传字符串枚举会被后端判定为非法状态。 */ () => {
    const status = findField('status');

    expect(status).toMatchObject({
      component: 'Select',
      label: '开启状态',
    });
    expect(componentProps(status).options).toEqual([
      { label: '开启', value: 0 },
      { label: '关闭', value: 1 },
    ]);
    expect(parseableRule(status.rules).parse(undefined)).toBe(
      CommonStatusEnum.ENABLE,
    );
  });

  it('模板编号、名称、API 编号、渠道与内容为必填项', /** 漏必填会让缺少内容的模板落库并在发送时失败。 */ () => {
    const requiredFields: Array<[string, string, string]> = [
      ['code', '模板编号', '请输入模板编号'],
      ['name', '模板名称', '请输入模板名称'],
      ['apiTemplateId', 'API 模板编号', '请输入 API 模板编号'],
      ['channelId', '短信渠道', '请输入短信渠道编号'],
    ];

    for (const [fieldName, label, placeholder] of requiredFields) {
      const field = findField(fieldName);
      expect(field).toMatchObject({
        component: 'Input',
        label,
        rules: 'required',
      });
      expect(componentProps(field).placeholder).toBe(placeholder);
    }
    const content = findField('content');
    expect(content).toMatchObject({
      component: 'Textarea',
      label: '模板内容',
      rules: 'required',
    });
    expect(componentProps(content).placeholder).toBe('请输入模板内容');
  });

  it('备注为选填项', /** 把备注误设必填会让用户无法保存模板。 */ () => {
    const remark = findField('remark');

    expect(remark).toMatchObject({ component: 'Textarea', label: '备注' });
    expect(remark.rules).toBeUndefined();
    expect(componentProps(remark).placeholder).toBe('请输入备注');
  });
});

describe('短信模板搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明编号、类型与状态筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('模板编号筛选可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const code = useGridFormSchema()[0];

    expect(code).toMatchObject({ component: 'Input', label: '模板编号' });
    expect(componentProps(code)).toEqual({
      clearable: true,
      placeholder: '请输入模板编号',
    });
  });

  it('类型与状态筛选使用数值型字典并允许清空', /** 字典类型写错会让筛选下拉为空，无法筛选。 */ () => {
    const schema = useGridFormSchema();

    expect(schema[1]).toMatchObject({ component: 'Select', label: '短信类型' });
    expect(componentProps(schema[1])).toEqual({
      clearable: true,
      options: [
        { label: '验证码', value: 1 },
        { label: '通知', value: 2 },
      ],
      placeholder: '请选择短信类型',
    });
    expect(schema[2]).toMatchObject({ component: 'Select', label: '状态' });
    expect(componentProps(schema[2])).toEqual({
      clearable: true,
      options: [
        { label: '开启', value: 0 },
        { label: '关闭', value: 1 },
      ],
      placeholder: '请选择状态',
    });
  });
});

describe('短信模板列定义', /** 列定义决定用户看到的字段、宽度与格式化结果。 */ () => {
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

  it('类型与状态列挂载对应字典渲染器', /** 字典类型写错会让列显示成裸枚举值。 */ () => {
    expect(findColumn('type')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_SMS_TEMPLATE_TYPE },
      },
      title: '短信类型',
    });
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      title: '状态',
    });
  });

  it('模板内容与 API 编号列给出可读宽度', /** 宽度不足会让长模板撑破表格。 */ () => {
    expect(findColumn('content')).toMatchObject({
      minWidth: 200,
      title: '模板内容',
    });
    expect(findColumn('apiTemplateId')).toMatchObject({
      minWidth: 140,
      title: 'API 模板编号',
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

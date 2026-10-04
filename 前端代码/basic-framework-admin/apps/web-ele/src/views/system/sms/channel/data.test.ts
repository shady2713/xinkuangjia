/**
 * 短信渠道列表元数据（views/system/sms/channel/data）真实行为回归。
 *
 * 该模块向渠道表单与渠道列表提供字段定义：字段名写错会让渠道签名或密钥落到错误字段；
 * 渠道编码与状态必须按约定字典类型与取值类型渲染，否则后端收到非法枚举；API 密钥列
 * 缺少宽度会让长密钥撑破表格，时间列缺少格式化会让用户看到时间戳。用例使用真实字典
 * 缓存与真实字典取值函数，只写入当前活动的字典缓存，不替换被测模块的实现。
 */
import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useFormSchema, useGridColumns, useGridFormSchema } from './data';

/** 渠道表单的字段顺序，决定新增/修改弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'code',
  'signature',
  'status',
  'apiKey',
  'apiSecret',
  'callbackUrl',
  'remark',
];

/** 渠道搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['signature', 'code', 'status'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'id',
  'signature',
  'code',
  'status',
  'remark',
  'apiKey',
  'callbackUrl',
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

/** 校验规则最小契约：用例只读取默认值与解析判定。 */
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
      [DICT_TYPE.SYSTEM_SMS_CHANNEL_CODE]: [
        { label: '阿里云', value: 'ALIYUN' },
        { label: '腾讯云', value: 'TENCENT' },
      ],
    });
  },
);

describe('短信渠道表单字段', /** 字段名与校验决定渠道配置能否正确落库。 */ () => {
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

  it('渠道编码使用字符串型字典且必填', /** 传数值枚举会让后端匹配不到渠道实现。 */ () => {
    const code = findField('code');

    expect(code).toMatchObject({
      component: 'Select',
      label: '短信渠道',
      rules: 'required',
    });
    expect(componentProps(code)).toEqual({
      options: [
        { label: '阿里云', value: 'ALIYUN' },
        { label: '腾讯云', value: 'TENCENT' },
      ],
      placeholder: '请选择短信渠道',
    });
  });

  it('签名、API Key 为必填项', /** 漏必填会让无法发送短信的渠道落库。 */ () => {
    expect(findField('signature')).toMatchObject({
      component: 'Input',
      label: '短信签名',
      rules: 'required',
    });
    expect(componentProps(findField('signature')).placeholder).toBe(
      '请输入短信签名',
    );
    expect(findField('apiKey')).toMatchObject({
      component: 'Input',
      label: 'API Key',
      rules: 'required',
    });
    expect(componentProps(findField('apiKey')).placeholder).toBe(
      '请输入 API Key',
    );
  });

  it('密钥、回调地址与备注为选填项', /** 把选填项误设必填会让只配置签名的渠道无法保存。 */ () => {
    expect(findField('apiSecret')).toMatchObject({
      component: 'Input',
      label: 'API Secret',
    });
    expect(findField('apiSecret').rules).toBeUndefined();
    expect(componentProps(findField('apiSecret')).placeholder).toBe(
      '请输入 API Secret',
    );
    expect(findField('callbackUrl')).toMatchObject({
      component: 'Input',
      label: '回调地址',
    });
    expect(componentProps(findField('callbackUrl')).placeholder).toBe(
      '请输入回调地址',
    );
    expect(findField('remark')).toMatchObject({
      component: 'Textarea',
      label: '备注',
    });
    expect(componentProps(findField('remark')).placeholder).toBe('请输入备注');
  });

  it('开启状态使用数值型字典并默认开启', /** 传字符串枚举会被后端判定为非法状态。 */ () => {
    const status = findField('status');

    expect(status).toMatchObject({
      component: 'RadioGroup',
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
});

describe('短信渠道搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明签名、渠道与状态筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('签名筛选可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const signature = useGridFormSchema()[0];

    expect(signature).toMatchObject({ component: 'Input', label: '短信签名' });
    expect(componentProps(signature)).toEqual({
      clearable: true,
      placeholder: '请输入短信签名',
    });
  });

  it('渠道与状态筛选使用对应字典并允许清空', /** 字典类型写错会让筛选下拉为空，无法筛选。 */ () => {
    const schema = useGridFormSchema();

    expect(schema[1]).toMatchObject({ component: 'Select', label: '短信渠道' });
    expect(componentProps(schema[1])).toEqual({
      clearable: true,
      options: [
        { label: '阿里云', value: 'ALIYUN' },
        { label: '腾讯云', value: 'TENCENT' },
      ],
      placeholder: '请选择短信渠道',
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

describe('短信渠道列定义', /** 列定义决定用户看到的字段、宽度与格式化结果。 */ () => {
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

  it('渠道编码与状态列挂载对应字典渲染器', /** 字典类型写错会让列显示成裸枚举值。 */ () => {
    expect(findColumn('code')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_SMS_CHANNEL_CODE },
      },
      title: '渠道编码',
    });
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      title: '开启状态',
    });
  });

  it('密钥与回调地址列给出可读宽度', /** 宽度不足会让长密钥与长回调地址撑破表格。 */ () => {
    expect(findColumn('apiKey')).toMatchObject({
      minWidth: 180,
      title: 'API Key',
    });
    expect(findColumn('callbackUrl')).toMatchObject({
      minWidth: 200,
      title: '回调地址',
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

/**
 * 参数配置列表元数据（views/infra/config/data）真实行为回归。
 *
 * 该模块向参数表单与参数列表提供字段定义：参数键名与键值字段写错会让配置项落到错误
 * 字段；分类长度校验写错会让超长分类落库或让合法分类被拒；是否可见必须按字符串型
 * 布尔字典渲染，否则后端收到布尔字面量会判定非法；创建时间筛选缺少时间范围属性会让
 * 后端收到格式不符的时间串；时间列缺少格式化会让用户看到时间戳。用例使用真实字典
 * 缓存、真实时间范围属性与真实校验规则，只替换翻译边界。
 */
import { DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/** 参数表单的字段顺序，决定新增/修改弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'category',
  'name',
  'key',
  'value',
  'visible',
  'remark',
];

/** 参数搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['name', 'key', 'type', 'createTime'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'id',
  'category',
  'name',
  'key',
  'value',
  'visible',
  'type',
  'remark',
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

/** 校验规则最小契约：用例只读取首条错误信息。 */
interface ParseableRule {
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
 * 取出取值被拒绝时的首条错误信息。
 * @param rule 字段声明的校验规则。
 * @param value 交给校验器解析的取值。
 * @returns 首条错误信息。
 * @throws Error 取值意外通过校验时抛出，避免用例静默地什么都不验证。
 */
function firstIssueMessage(rule: unknown, value: unknown) {
  const result = parseableRule(rule).safeParse(value);
  if (result.success) {
    throw new Error(`取值被误判为合法：${JSON.stringify(value)}`);
  }
  const message = result.error.issues[0]?.message;
  if (message === undefined) {
    throw new Error('校验失败但未给出错误信息');
  }
  return message;
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
      [DICT_TYPE.INFRA_BOOLEAN_STRING]: [
        { label: '是', value: 'true' },
        { label: '否', value: 'false' },
      ],
      [DICT_TYPE.INFRA_CONFIG_TYPE]: [
        { label: '系统内置', value: '1' },
        { label: '自定义', value: '2' },
      ],
    });
  },
);

describe('参数表单字段', /** 字段名与校验决定参数配置能否正确落库。 */ () => {
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

  it('参数分类按长度校验并给出中文提示', /** 上限放宽会让超长分类落库，下限缺失会让空分类通过。 */ () => {
    const category = findField('category');

    expect(category).toMatchObject({ component: 'Input', label: '参数分类' });
    expect(componentProps(category).placeholder).toBe('请输入参数分类');
    expect(parseableRule(category.rules).safeParse('系统配置').success).toBe(
      true,
    );
    expect(firstIssueMessage(category.rules, '')).toBe('请输入参数分类');
    expect(firstIssueMessage(category.rules, 'a'.repeat(51))).toBe(
      '参数分类不能超过50个字符',
    );
  });

  it('名称、键名与键值为必填项', /** 漏必填会让没有键名的配置项落库。 */ () => {
    const requiredFields: Array<[string, string, string]> = [
      ['name', '参数名称', '请输入参数名称'],
      ['key', '参数键名', '请输入参数键名'],
      ['value', '参数键值', '请输入参数键值'],
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
  });

  it('是否可见使用字符串型布尔字典并默认可见', /** 传布尔字面量会被后端判定为非法取值。 */ () => {
    const visible = findField('visible');

    expect(visible).toMatchObject({
      component: 'RadioGroup',
      defaultValue: true,
      label: '是否可见',
      rules: 'required',
    });
    expect(componentProps(visible).options).toEqual([
      { label: '是', value: true },
      { label: '否', value: false },
    ]);
  });

  it('备注为选填的多行文本', /** 把备注误设必填会让用户无法保存配置。 */ () => {
    const remark = findField('remark');

    expect(remark).toMatchObject({ component: 'Textarea', label: '备注' });
    expect(remark.rules).toBeUndefined();
    expect(componentProps(remark).placeholder).toBe('请输入备注');
  });
});

describe('参数搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明名称、键名、内置类型与创建时间', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('文本筛选可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const schema = useGridFormSchema();

    expect(schema[0]).toMatchObject({ component: 'Input', label: '参数名称' });
    expect(componentProps(schema[0])).toEqual({
      clearable: true,
      placeholder: '请输入参数名称',
    });
    expect(schema[1]).toMatchObject({ component: 'Input', label: '参数键名' });
    expect(componentProps(schema[1])).toEqual({
      clearable: true,
      placeholder: '请输入参数键名',
    });
  });

  it('系统内置筛选使用数值型字典并允许清空', /** 字典类型写错会让筛选下拉为空，无法筛选。 */ () => {
    const type = useGridFormSchema()[2];

    expect(type).toMatchObject({ component: 'Select', label: '系统内置' });
    expect(componentProps(type)).toEqual({
      clearable: true,
      options: [
        { label: '系统内置', value: 1 },
        { label: '自定义', value: 2 },
      ],
      placeholder: '请选择系统内置',
    });
  });

  it('创建时间沿用真实时间范围属性并允许清空', /** 缺少值格式会让后端收到非约定格式的时间串。 */ () => {
    const createTime = useGridFormSchema()[3];
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

describe('参数列定义', /** 列定义决定用户看到的字段、宽度与格式化结果。 */ () => {
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

  it('是否可见与系统内置列挂载对应字典渲染器', /** 字典类型写错会让列显示成裸取值。 */ () => {
    expect(findColumn('visible')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_BOOLEAN_STRING },
      },
      title: '是否可见',
    });
    expect(findColumn('type')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_CONFIG_TYPE },
      },
      title: '系统内置',
    });
  });

  it('键名与键值列给出可读宽度', /** 宽度不足会让长键值撑破表格。 */ () => {
    expect(findColumn('key')).toMatchObject({
      minWidth: 200,
      title: '参数键名',
    });
    expect(findColumn('value')).toMatchObject({
      minWidth: 150,
      title: '参数键值',
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

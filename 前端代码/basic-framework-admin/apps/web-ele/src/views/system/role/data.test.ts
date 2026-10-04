/**
 * 角色元数据（views/system/role/data）真实行为回归。
 *
 * 该模块向角色表单、数据权限弹窗、菜单权限弹窗与角色列表提供字段与列定义：
 * 主键字段不隐藏会让用户误改记录标识；数据权限弹窗的部门范围未按“指定部门”联动
 * 会让用户看不到部门选择入口；角色状态与角色类型缺少字典单元格会让列表显示原始
 * 字典值；创建时间缺少时间范围默认属性会让后端收到格式不符的时间串；操作列不固定
 * 在右侧会随横向滚动消失。用例真实调用每个导出函数，并真实执行返回结构里的每个
 * 联动函数，只替换字典缓存边界。
 */
import type { VbenFormSchema } from '#/adapter/form';

import {
  CommonStatusEnum,
  DICT_TYPE,
  SystemDataScopeEnum,
} from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { getRangePickerDefaultProps } from '#/utils';

import {
  useAssignDataPermissionFormSchema,
  useAssignMenuFormSchema,
  useFormSchema,
  useGridColumns,
  useGridFormSchema,
} from './data';

/** 角色表单的字段顺序，决定新增与修改弹窗的录入顺序。 */
const FORM_FIELDS = ['id', 'name', 'code', 'sort', 'status', 'remark'];

/** 数据权限表单的字段顺序，决定分配数据权限弹窗的录入顺序。 */
const ASSIGN_DATA_FIELDS = [
  'id',
  'name',
  'code',
  'dataScope',
  'dataScopeDeptIds',
];

/** 菜单权限表单的字段顺序，决定分配菜单权限弹窗的录入顺序。 */
const ASSIGN_MENU_FIELDS = ['id', 'name', 'code', 'menuIds'];

/** 列表搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['name', 'code', 'status', 'createTime'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'id',
  'name',
  'type',
  'code',
  'sort',
  'remark',
  'status',
  'createTime',
  undefined,
];

/** 字段显示条件：按当前表单值判断字段是否渲染。 */
type ShowPredicate = (values: Record<string, unknown>) => boolean;

/** 字段依赖配置：声明触发重新计算的字段与显示条件。 */
interface FieldDependencies {
  /** 判断字段当前是否显示；返回 false 时字段被隐藏。 */
  show?: ShowPredicate;
  /** 触发重新计算的字段名列表，空串表示任意字段变化。 */
  triggerFields?: string[];
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
 * 取出表单字段的依赖配置。
 * @param item 表单字段定义。
 * @returns 依赖配置；字段未声明依赖时返回空对象。
 */
function fieldDependencies(item: unknown) {
  return ((item as undefined | { dependencies?: FieldDependencies })
    ?.dependencies ?? {}) as FieldDependencies;
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
  /** 每例重建字典缓存，让状态与角色类型字典走真实取值链路。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.COMMON_STATUS]: [
        { label: '开启', value: '0' },
        { label: '关闭', value: '1' },
      ],
      [DICT_TYPE.SYSTEM_DATA_SCOPE]: [
        { label: '全部数据权限', value: '1' },
        { label: '指定部门数据权限', value: '2' },
      ],
      [DICT_TYPE.SYSTEM_ROLE_TYPE]: [
        { label: '内置角色', value: '1' },
        { label: '自定义角色', value: '2' },
      ],
    });
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

describe('角色表单字段', /** 字段名与校验决定角色能否正确落库。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让用户无法录入，顺序错乱会降低可读性。 */ () => {
    expect(
      useFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(FORM_FIELDS);
  });

  it('主键字段隐藏且声明空触发字段', /** 主键可见会让用户误改记录标识，缺少依赖配置会让隐藏失效。 */ () => {
    const id = findField(useFormSchema(), 'id');
    const dependencies = fieldDependencies(id);
    const show = dependencies.show;

    expect(id.component).toBe('Input');
    expect(dependencies.triggerFields).toEqual(['']);
    expect(typeof show).toBe('function');
    expect(show?.({})).toBe(false);
  });

  it('名称、标识与顺序为必填并声明输入提示', /** 缺少必填会让空角色落库，提示写错会误导录入。 */ () => {
    const schema = useFormSchema();

    expect(findField(schema, 'name')).toMatchObject({
      component: 'Input',
      label: '角色名称',
      rules: 'required',
    });
    expect(componentProps(findField(schema, 'name')).placeholder).toBe(
      '请输入角色名称',
    );
    expect(findField(schema, 'code')).toMatchObject({
      component: 'Input',
      label: '角色标识',
      rules: 'required',
    });
    expect(componentProps(findField(schema, 'code')).placeholder).toBe(
      '请输入角色标识',
    );
    expect(findField(schema, 'sort')).toMatchObject({
      component: 'InputNumber',
      label: '显示顺序',
      rules: 'required',
    });
    expect(componentProps(findField(schema, 'sort'))).toMatchObject({
      class: '!w-full',
      controlsPosition: 'right',
      min: 0,
    });
  });

  it('角色状态取自状态字典并默认启用', /** 字典类型写错会让状态选项为空，默认值写错会让新角色默认停用。 */ () => {
    const status = findField(useFormSchema(), 'status');

    expect(status).toMatchObject({
      component: 'RadioGroup',
      label: '角色状态',
    });
    expect(componentProps(status).options).toEqual([
      { label: '开启', value: 0 },
      { label: '关闭', value: 1 },
    ]);
    const rule = status.rules as DefaultValueRule;
    expect(rule.parse(undefined)).toBe(CommonStatusEnum.ENABLE);
  });

  it('备注使用多行文本', /** 单行输入会让长备注难以阅读。 */ () => {
    const remark = findField(useFormSchema(), 'remark');

    expect(remark).toMatchObject({ component: 'Textarea', label: '角色备注' });
    expect(componentProps(remark).placeholder).toBe('请输入角色备注');
  });
});

describe('数据权限表单字段', /** 权限范围联动决定部门范围入口是否出现。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让管理员无法分配数据权限。 */ () => {
    expect(
      useAssignDataPermissionFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(ASSIGN_DATA_FIELDS);
  });

  it('角色名称与标识只读回显', /** 可编辑会让管理员在授权时改错角色身份。 */ () => {
    const schema = useAssignDataPermissionFormSchema();

    expect(findField(schema, 'name')).toMatchObject({
      component: 'Input',
      label: '角色名称',
    });
    expect(componentProps(findField(schema, 'name'))).toEqual({
      disabled: true,
    });
    expect(componentProps(findField(schema, 'code'))).toEqual({
      disabled: true,
    });
    expect(fieldDependencies(findField(schema, 'id')).show?.({})).toBe(false);
  });

  it('权限范围取自数据范围字典', /** 字典类型写错会让管理员选不到权限范围。 */ () => {
    const dataScope = findField(
      useAssignDataPermissionFormSchema(),
      'dataScope',
    );

    expect(dataScope).toMatchObject({
      component: 'Select',
      label: '权限范围',
    });
    expect(componentProps(dataScope).options).toEqual([
      { label: '全部数据权限', value: 1 },
      { label: '指定部门数据权限', value: 2 },
    ]);
  });

  it('部门范围只在指定部门权限下显示', /** 联动条件写错会让用户在任何权限范围下都看到或都看不到部门范围。 */ () => {
    const deptIds = findField(
      useAssignDataPermissionFormSchema(),
      'dataScopeDeptIds',
    );
    const dependencies = fieldDependencies(deptIds);
    const show = dependencies.show;

    expect(deptIds).toMatchObject({
      component: 'Input',
      formItemClass: 'items-start',
      label: '部门范围',
    });
    expect(dependencies.triggerFields).toEqual(['dataScope']);
    expect(typeof show).toBe('function');
    expect(show?.({ dataScope: SystemDataScopeEnum.DEPT_CUSTOM })).toBe(true);
    expect(show?.({ dataScope: SystemDataScopeEnum.ALL })).toBe(false);
  });
});

describe('菜单权限表单字段', /** 菜单权限字段决定授权结果能否提交。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让管理员无法分配菜单权限。 */ () => {
    expect(
      useAssignMenuFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(ASSIGN_MENU_FIELDS);
  });

  it('菜单权限使用整块表单项并由页面插槽填充', /** 缺少整块布局会让菜单树被压进单行表单项。 */ () => {
    const menuIds = findField(useAssignMenuFormSchema(), 'menuIds');

    expect(menuIds).toMatchObject({
      component: 'Input',
      formItemClass: 'items-start',
      label: '菜单权限',
    });
    expect(
      fieldDependencies(findField(useAssignMenuFormSchema(), 'id')).show?.({}),
    ).toBe(false);
  });
});

describe('角色列表搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明名称、标识、状态与创建时间筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (row) => row.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('名称与标识可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const schema = useGridFormSchema();

    expect(componentProps(findField(schema, 'name'))).toEqual({
      clearable: true,
      placeholder: '请输入角色名称',
    });
    expect(componentProps(findField(schema, 'code'))).toEqual({
      clearable: true,
      placeholder: '请输入角色标识',
    });
  });

  it('状态筛选取自状态字典且可清空', /** 字典类型写错会让筛选下拉为空。 */ () => {
    const status = findField(useGridFormSchema(), 'status');

    expect(status).toMatchObject({ component: 'Select', label: '角色状态' });
    expect(componentProps(status)).toEqual({
      clearable: true,
      options: [
        { label: '开启', value: 0 },
        { label: '关闭', value: 1 },
      ],
      placeholder: '请选择角色状态',
    });
  });

  it('创建时间沿用真实时间范围属性并允许清空', /** 缺少值格式会让后端收到非约定格式的时间串。 */ () => {
    const createTime = findField(useGridFormSchema(), 'createTime');
    const defaults = getRangePickerDefaultProps();
    const props = componentProps(createTime);

    expect(createTime).toMatchObject({
      component: 'RangePicker',
      label: '创建时间',
    });
    expect(props.clearable).toBe(true);
    expect(props.format).toBe(defaults.format);
    expect(props.valueFormat).toBe(defaults.valueFormat);
    expect(props.defaultTime).toHaveLength(2);
    expect(props.shortcuts).toHaveLength(defaults.shortcuts.length);
  });
});

describe('角色列表列定义', /** 列定义决定用户看到的字段、宽度与字典展示。 */ () => {
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
      width: 240,
    });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });

  it('角色类型与角色状态挂载字典单元格', /** 缺少字典单元格会让列表显示原始字典值。 */ () => {
    expect(findColumn('type')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_ROLE_TYPE },
      },
      minWidth: 100,
      title: '角色类型',
    });
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      minWidth: 100,
      title: '角色状态',
    });
  });

  it('创建时间列挂载真实格式化器', /** 缺少格式化会让用户看到时间戳。 */ () => {
    expect(findColumn('createTime')).toMatchObject({
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '创建时间',
    });
  });
});

/**
 * 部门列表元数据（views/system/dept/data）真实行为回归。
 *
 * 该模块向部门表单与部门列表提供字段定义，并在模块加载时预取负责人下拉数据：
 * 上级部门选择器缺少虚拟根会让顶级部门无法作为父节点；部门树拼装写错会让层级丢失；
 * 负责人下拉未绑定真实用户接口会让用户选不到负责人；负责人列取不到昵称时会显示成
 * 用户编号；联系电话与邮箱的校验规则标签写错会让提示指向错误字段。用例只替换两个
 * 网络边界，树拼装、字典取值与校验规则保持真实实现。
 */
import { flushPromises } from '@vue/test-utils';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeptList } from '#/api/system/dept';
import { getSimpleUserList } from '#/api/system/user';

import { useFormSchema, useGridColumns } from './data';

/** 部门表单的字段顺序，决定新增/修改弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'parentId',
  'name',
  'sort',
  'leaderUserId',
  'phone',
  'email',
  'status',
];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'name',
  'leaderUserId',
  'sort',
  'status',
  'createTime',
  undefined,
];

/** 用户列表请求的完成回调：把夹具用户列表交给模块加载时注册的回调。 */
type ResolveUsers = (users: Array<{ id: number; nickname: string }>) => void;

/** 部门夹具与用户列表请求句柄：模块加载时即被网络替身读取，需先于导入建立。 */
const fixtures = vi.hoisted(
  /** 建立两级部门夹具与可延迟解决的请求容器。 */ () => ({
    dept: [
      { id: 1, name: '研发部', parentId: 0 },
      { id: 2, name: '前端组', parentId: 1 },
    ],
    user: [
      { id: 11, nickname: '管理员' },
      { id: 12, nickname: '张三' },
    ],
    /** 用户列表请求的解决句柄，由用例注入夹具。 */
    resolveUser: undefined as ResolveUsers | undefined,
  }),
);

vi.mock(
  '#/api/system/dept',
  /** 只替换部门列表网络边界，部门树拼装保持真实实现。 */ () => ({
    getDeptList: vi.fn(
      /** 返回固定部门夹具，供真实树拼装消费。 */ async () => fixtures.dept,
    ),
  }),
);

vi.mock(
  '#/api/system/user',
  /** 只替换用户列表网络边界，负责人昵称解析保持真实实现。 */ () => ({
    /**
     * 返回一个由用例控制完成时机的用户列表请求。
     * @returns 待用例解决的用户列表 Promise。
     */
    getSimpleUserList: () =>
      new Promise<Array<{ id: number; nickname: string }>>(
        /** 记录解决句柄，供用例注入夹具。 */ (resolve) => {
          fixtures.resolveUser = resolve;
        },
      ),
  }),
);

/** 单元格格式化上下文：负责人列只读取单元格取值。 */
interface CellContext {
  cellValue: unknown;
}

/** 负责人列格式化器签名：按单元格取值解析负责人昵称。 */
type LeaderFormatter = (context: CellContext) => string;

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

/**
 * 让模块加载时发起的用户列表请求返回夹具。
 * @param users 要返回的用户列表。
 * @throws Error 请求尚未发起时抛出，避免用例静默地什么都不验证。
 */
async function resolveUserList(users: Array<{ id: number; nickname: string }>) {
  const resolve = fixtures.resolveUser;
  if (!resolve) {
    throw new Error('用户列表请求尚未发起');
  }
  resolve(users);
  await flushPromises();
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

describe('部门表单字段', /** 字段名与校验决定部门层级与联系方式能否正确落库。 */ () => {
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

  it('上级部门选择器加载真实部门树并补虚拟根', /** 缺少虚拟根会让顶级部门无法被选为父节点，树拼装写错会丢失层级。 */ async () => {
    const parentId = findField('parentId');
    const props = componentProps(parentId);

    expect(parentId).toMatchObject({
      component: 'ApiTreeSelect',
      label: '上级部门',
      rules: 'selectRequired',
    });
    expect(props).toMatchObject({
      childrenField: 'children',
      checkStrictly: true,
      clearable: true,
      defaultExpandAll: true,
      labelField: 'name',
      placeholder: '请选择上级部门',
      valueField: 'id',
    });

    const api = props.api;
    if (typeof api !== 'function') {
      throw new TypeError('上级部门选择器未声明加载接口');
    }
    const tree = (await api()) as Array<{
      children?: unknown[];
      id: number;
      name: string;
    }>;

    expect(getDeptList).toHaveBeenCalledTimes(1);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: 0, name: '顶级部门' });
    expect(tree[0]?.children).toHaveLength(1);
    expect(tree[0]?.children?.[0]).toMatchObject({ id: 1, name: '研发部' });
  });

  it('部门名称与显示顺序为必填项', /** 漏必填会让无名称的部门落库。 */ () => {
    expect(findField('name')).toMatchObject({
      component: 'Input',
      label: '部门名称',
      rules: 'required',
    });
    expect(componentProps(findField('name')).placeholder).toBe(
      '请输入部门名称',
    );
    expect(findField('sort')).toMatchObject({
      component: 'InputNumber',
      label: '显示顺序',
      rules: 'required',
    });
    expect(componentProps(findField('sort'))).toMatchObject({
      class: '!w-full',
      controlsPosition: 'right',
      min: 0,
    });
  });

  it('负责人下拉绑定真实用户接口并允许空值', /** 未绑定真实接口会让用户选不到负责人，必填会让部门无法只填名称。 */ () => {
    const leaderUserId = findField('leaderUserId');

    expect(leaderUserId).toMatchObject({
      component: 'ApiSelect',
      label: '负责人',
    });
    expect(componentProps(leaderUserId)).toMatchObject({
      api: getSimpleUserList,
      clearable: true,
      labelField: 'nickname',
      placeholder: '请选择负责人',
      valueField: 'id',
    });
    const rule = parseableRule(leaderUserId.rules);
    expect(rule.parse(undefined)).toBeUndefined();
    expect(rule.parse(null)).toBeNull();
    expect(rule.parse(11)).toBe(11);
  });

  it('联系电话与邮箱使用带字段名的选填校验', /** 标签写错会让提示指向错误字段，误设必填会让选填资料无法保存。 */ () => {
    const phone = findField('phone');
    const email = findField('email');

    expect(phone).toMatchObject({ component: 'Input', label: '联系电话' });
    expect(componentProps(phone)).toMatchObject({
      maxLength: 11,
      placeholder: '请输入联系电话',
    });
    expect(firstIssueMessage(phone.rules, 'abc')).toBe('联系电话格式不正确');
    expect(parseableRule(phone.rules).safeParse(undefined).success).toBe(true);

    expect(email).toMatchObject({ component: 'Input', label: '邮箱' });
    expect(componentProps(email).placeholder).toBe('请输入邮箱');
    expect(firstIssueMessage(email.rules, 'abc')).toBe('邮箱格式不正确');
    expect(parseableRule(email.rules).safeParse('').success).toBe(true);
  });

  it('状态使用数值型字典并默认开启', /** 传字符串枚举会被后端判定为非法状态。 */ () => {
    const status = findField('status');

    expect(status).toMatchObject({ component: 'RadioGroup', label: '状态' });
    expect(componentProps(status).options).toEqual([
      { label: '开启', value: 0 },
      { label: '关闭', value: 1 },
    ]);
    expect(parseableRule(status.rules).parse(undefined)).toBe(
      CommonStatusEnum.ENABLE,
    );
  });
});

describe('部门列表列定义', /** 列定义决定用户看到的层级、负责人与格式化结果。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('首列是复选框且固定在最左，操作列固定在最右', /** 复选框不固定会随横向滚动消失，操作列不固定会让操作入口难以找到。 */ () => {
    const columns = gridColumns();
    const actions = columns.at(-1);

    expect(columns[0]).toMatchObject({
      fixed: 'left',
      type: 'checkbox',
      width: 40,
    });
    expect(actions).toMatchObject({
      fixed: 'right',
      title: '操作',
      width: 220,
    });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });

  it('部门名称列作为树节点展示', /** 缺少树节点标记会让层级退化成平铺列表。 */ () => {
    expect(findColumn('name')).toMatchObject({
      align: 'left',
      minWidth: 150,
      title: '部门名称',
      treeNode: true,
    });
  });

  it('负责人列按已加载用户解析昵称', /** 解析失败会让用户看到负责人编号，接口未预取会让负责人列全为占位符。 */ async () => {
    const rawFormatter = findColumn('leaderUserId').formatter;
    if (typeof rawFormatter !== 'function') {
      throw new TypeError('负责人列未声明格式化器');
    }
    const formatter = rawFormatter as LeaderFormatter;
    await resolveUserList(fixtures.user);

    // 数字编号与字符串编号都来自后端序列化，必须同样匹配。
    expect(formatter({ cellValue: 11 })).toBe('管理员');
    expect(formatter({ cellValue: '12' })).toBe('张三');
    // 未分配负责人或用户已被删除时退回占位符。
    expect(formatter({ cellValue: 99 })).toBe('-');
    expect(formatter({ cellValue: undefined })).toBe('-');
  });

  it('状态列挂载字典渲染器', /** 缺少字典渲染会让用户看到裸数字而不是状态文案。 */ () => {
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      title: '部门状态',
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

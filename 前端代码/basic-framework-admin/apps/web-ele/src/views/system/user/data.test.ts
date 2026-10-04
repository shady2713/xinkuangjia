/**
 * 用户元数据（views/system/user/data）真实行为回归。
 *
 * 该模块向用户表单、重置密码弹窗、分配角色弹窗、导入弹窗与用户列表提供字段与列定义：
 * 主键字段不隐藏会让用户误改记录标识；新增用户密码未复用个人中心的密码组件与复杂度
 * 规则会让弱密码落库；部门选择器未绑定部门接口并拼装成树会让用户选不到层级；岗位与
 * 角色下拉未按状态置灰会让用户把岗位或角色分配给已停用项；邮箱与手机号缺少校验会让
 * 脏数据落库；重置密码未校验新旧密码差异会让用户把密码改成原值；列表状态列未把切换
 * 回调透传给单元格会让管理员无法在列表内改状态。
 *
 * 用例真实调用每个导出函数，并真实执行返回结构里的每个联动函数、接口属性与校验规则；
 * 只替换部门、岗位、角色三个网络边界与字典缓存边界，zod 校验与树拼装保持真实实现。
 */
import type { VbenFormSchema } from '#/adapter/form';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';
import { $t } from '@vben/locales';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeptList } from '#/api/system/dept';
import { getSimplePostList } from '#/api/system/post';
import { getSimpleRoleList } from '#/api/system/role';
import { getRangePickerDefaultProps } from '#/utils';

import {
  useAssignRoleFormSchema,
  useFormSchema,
  useGridColumns,
  useGridFormSchema,
  useImportFormSchema,
  useResetPasswordFormSchema,
} from './data';

/** 用户表单的字段顺序，决定新增与修改弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'username',
  'password',
  'nickname',
  'deptId',
  'postIds',
  'email',
  'mobile',
  'sex',
  'status',
  'remark',
];

/** 重置密码表单的字段顺序，决定重置弹窗的录入顺序。 */
const RESET_FIELDS = ['id', 'newPassword', 'confirmPassword'];

/** 分配角色表单的字段顺序，决定分配弹窗的录入顺序。 */
const ASSIGN_FIELDS = ['id', 'username', 'nickname', 'roleIds'];

/** 用户导入表单的字段顺序，决定导入弹窗的录入顺序。 */
const IMPORT_FIELDS = ['file', 'updateSupport'];

/** 列表搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['username', 'mobile', 'createTime'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'id',
  'username',
  'nickname',
  'deptName',
  'mobile',
  'status',
  'createTime',
  undefined,
];

/** 部门夹具工厂：返回两级部门，供真实树拼装消费。 */
function deptFixture() {
  return [
    { id: 1, name: '研发部', parentId: 0 },
    { id: 2, name: '前端组', parentId: 1 },
  ];
}

/** 岗位夹具：一条启用、一条停用，用于核对按状态置灰。 */
const POST_FIXTURE = [
  { id: 11, name: '开发岗', status: CommonStatusEnum.ENABLE },
  { id: 12, name: '离职岗', status: CommonStatusEnum.DISABLE },
];

/** 角色夹具：一条启用、一条停用，用于核对按状态置灰。 */
const ROLE_FIXTURE = [
  { id: 21, name: '管理员', status: CommonStatusEnum.ENABLE },
  { id: 22, name: '停用角色', status: CommonStatusEnum.DISABLE },
];

vi.mock(
  '#/api/system/dept',
  /** 只替换部门列表网络边界，部门树拼装保持真实实现。 */ () => ({
    getDeptList: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/post',
  /** 只替换岗位列表网络边界，岗位置灰映射保持真实实现。 */ () => ({
    getSimplePostList: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/role',
  /** 只替换角色列表网络边界，角色置灰映射保持真实实现。 */ () => ({
    getSimpleRoleList: vi.fn(),
  }),
);

/** 校验失败结果：只读取可展示的错误信息列表。 */
interface RuleFailure {
  /** 校验问题列表，顺序与 zod 一致。 */
  issues: Array<{ message: string }>;
}

/** 校验结果：成功时带解析数据，失败时带错误信息。 */
type RuleResult =
  | { data: unknown; success: true }
  | { error: RuleFailure; success: false };

/** 校验器最小契约：用例只驱动取值解析与错误信息读取。 */
interface ParseableRule {
  /**
   * 解析取值并返回判定结果。
   * @param value 交给校验器解析的取值。
   * @returns 成功时带解析数据，失败时带错误信息。
   */
  safeParse(value: unknown): RuleResult;
}

/** 字段显示条件：按当前表单值判断字段是否渲染。 */
type ShowPredicate = (values: Record<string, unknown>) => boolean;

/** 依赖规则函数：按当前表单值生成该字段的校验规则。 */
type RulesResolver = (values: Record<string, unknown>) => unknown;

/** 字段依赖配置：声明触发重新计算的字段、显示条件与规则函数。 */
interface FieldDependencies {
  /** 按当前表单值生成校验规则。 */
  rules?: RulesResolver;
  /** 判断字段当前是否显示；返回 false 时字段被隐藏。 */
  show?: ShowPredicate;
  /** 触发重新计算的字段名列表，空串表示任意字段变化。 */
  triggerFields?: string[];
}

/** 无参接口调用签名：返回接口结果。 */
type ApiCall = () => Promise<unknown>;

/** 列表映射签名：把接口列表逐项映射为下拉选项。 */
type ListMapper = (list: unknown) => Promise<unknown>;

/** 单元格切换回调签名：与页面声明的回调保持一致。 */
type StatusChangeHandler = NonNullable<Parameters<typeof useGridColumns>[0]>;

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
 * 取出列声明的单元格渲染配置。
 * @param column 列定义。
 * @returns 单元格渲染配置；列未声明时返回空对象。
 */
function cellRender(column: unknown) {
  return ((column as undefined | { cellRender?: Record<string, unknown> })
    ?.cellRender ?? {}) as Record<string, unknown>;
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
 * 判断取值是否通过字段声明的校验规则。
 * @param rule 字段声明的校验规则。
 * @param value 交给校验器解析的取值。
 * @returns 通过校验时为 true。
 */
function passesRule(rule: unknown, value: unknown) {
  return parseableRule(rule).safeParse(value).success;
}

/**
 * 取出校验失败时全部可展示的错误信息。
 * @param rule 字段声明的校验规则。
 * @param value 交给校验器解析的取值。
 * @returns 序列化后的错误信息文本，便于核对自定义提示是否生效。
 * @throws Error 取值意外通过校验时抛出，避免用例静默地什么都不验证。
 */
function issueText(rule: unknown, value: unknown) {
  const result = parseableRule(rule).safeParse(value);
  if (result.success) {
    throw new Error(`取值被误判为合法：${JSON.stringify(value)}`);
  }
  return JSON.stringify(result.error.issues);
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
 * @param onStatusChange 页面声明的状态切换回调。
 * @returns 列定义数组。
 * @throws TypeError 列定义未返回时抛出，避免用例静默地什么都不验证。
 */
function gridColumns(onStatusChange?: StatusChangeHandler) {
  const columns = useGridColumns(onStatusChange);
  if (!columns) {
    throw new TypeError('列定义未返回');
  }
  return columns;
}

/**
 * 按业务字段取出表格列定义。
 * @param columns 列定义数组。
 * @param field 列的 field 值。
 * @returns 命中的列定义。
 * @throws Error 找不到该列时抛出，避免用例静默地什么都不验证。
 */
function findColumn(columns: ReturnType<typeof gridColumns>, field: string) {
  const column = columns.find(
    /** 只挑出目标业务字段的列，其余列与本断言无关。 */ (item) =>
      item.field === field,
  );
  if (!column) {
    throw new Error(`列定义缺少字段：${field}`);
  }
  return column;
}

beforeEach(
  /** 每例重建字典缓存与网络替身，让字典取值与接口调用走真实链路。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.COMMON_STATUS]: [
        { label: '开启', value: '0' },
        { label: '关闭', value: '1' },
      ],
      [DICT_TYPE.SYSTEM_USER_SEX]: [
        { label: '男', value: '1' },
        { label: '女', value: '2' },
      ],
    });
    vi.mocked(getDeptList).mockResolvedValue(deptFixture() as never);
    vi.mocked(getSimplePostList).mockResolvedValue(POST_FIXTURE as never);
    vi.mocked(getSimpleRoleList).mockResolvedValue(ROLE_FIXTURE as never);
  },
);

describe('用户表单字段', /** 字段与校验决定用户能否正确落库。 */ () => {
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

    expect(id.component).toBe('Input');
    expect(dependencies.triggerFields).toEqual(['']);
    expect(dependencies.show?.({})).toBe(false);
  });

  it('新增用户密码字段使用与个人中心一致的密码组件和规则', /** 锁定新增用户密码项，避免后续回退成仅必填但不校验复杂度的表单配置。 */ () => {
    const passwordField = findField(useFormSchema(), 'password');
    const dependencies = fieldDependencies(passwordField);
    const show = dependencies.show;

    expect(passwordField).toMatchObject({
      component: 'VbenInputPassword',
      rules: 'passwordRequired',
    });
    expect(componentProps(passwordField)).toMatchObject({
      passwordStrength: true,
      placeholder: '请输入用户密码',
    });
    expect(dependencies.triggerFields).toEqual(['id']);
    expect(typeof show).toBe('function');
    expect(show?.({})).toBe(true);
    expect(show?.({ id: 5 })).toBe(false);
  });

  it('归属部门绑定部门接口并拼装成树', /** 未绑定接口会让用户选不到部门，未拼装树会让层级丢失。 */ () => {
    const deptId = findField(useFormSchema(), 'deptId');
    const props = componentProps(deptId);
    const api = props.api;

    expect(deptId).toMatchObject({
      component: 'ApiTreeSelect',
      label: '归属部门',
    });
    expect(props).toMatchObject({
      checkStrictly: true,
      childrenField: 'children',
      defaultExpandAll: true,
      labelField: 'name',
      placeholder: '请选择归属部门',
      valueField: 'id',
    });
    expect(typeof api).toBe('function');
    expect(api).toBeDefined();
  });

  it('部门接口返回扁平列表时拼装出父子层级', /** 树拼装写错会让子部门出现在顶层或直接丢失。 */ async () => {
    const props = componentProps(findField(useFormSchema(), 'deptId'));
    const api = props.api as ApiCall;

    await expect(api()).resolves.toEqual([
      {
        children: [{ id: 2, name: '前端组', parentId: 1 }],
        id: 1,
        name: '研发部',
        parentId: 0,
      },
    ]);
    expect(getDeptList).toHaveBeenCalledTimes(1);
  });

  it('岗位下拉绑定岗位接口并按状态置灰', /** 未绑定接口会让用户选不到岗位，未置灰会让已停用岗位仍可选。 */ async () => {
    const postIds = findField(useFormSchema(), 'postIds');
    const props = componentProps(postIds);
    const afterFetch = props.afterFetch;

    expect(postIds).toMatchObject({ component: 'ApiSelect', label: '岗位' });
    expect(props).toMatchObject({
      labelField: 'name',
      multiple: true,
      placeholder: '请选择岗位',
      valueField: 'id',
    });
    expect(props.api).toBe(getSimplePostList);
    expect(typeof afterFetch).toBe('function');
    await expect((afterFetch as ListMapper)(POST_FIXTURE)).resolves.toEqual([
      {
        disabled: false,
        id: 11,
        name: '开发岗',
        status: CommonStatusEnum.ENABLE,
      },
      {
        disabled: true,
        id: 12,
        name: '离职岗',
        status: CommonStatusEnum.DISABLE,
      },
    ]);
  });

  it('邮箱允许留空但拒绝非法格式', /** 缺少校验会让非法邮箱落库，过于严格会让用户无法清空邮箱。 */ () => {
    const email = findField(useFormSchema(), 'email');

    expect(passesRule(email.rules, 'user@example.com')).toBe(true);
    expect(passesRule(email.rules, '')).toBe(true);
    expect(passesRule(email.rules, 'not-an-email')).toBe(false);
    expect(issueText(email.rules, 'not-an-email')).toContain('邮箱格式不正确');
  });

  it('手机号允许留空但拒绝非法格式', /** 缺少校验会让非法手机号落库，过于严格会让用户无法清空手机号。 */ () => {
    const mobile = findField(useFormSchema(), 'mobile');

    expect(passesRule(mobile.rules, '13800138000')).toBe(true);
    expect(passesRule(mobile.rules, '')).toBe(true);
    expect(passesRule(mobile.rules, '12345')).toBe(false);
    expect(issueText(mobile.rules, '12345')).toContain('手机号码格式不正确');
  });

  it('性别与状态取自字典并给出默认值', /** 字典类型写错会让选项为空，默认值写错会让新用户默认停用。 */ () => {
    const schema = useFormSchema();
    const sex = findField(schema, 'sex');
    const status = findField(schema, 'status');

    expect(componentProps(sex).options).toEqual(
      getDictOptions(DICT_TYPE.SYSTEM_USER_SEX, 'number'),
    );
    expect(parseableRule(sex.rules).safeParse(undefined)).toMatchObject({
      data: 1,
      success: true,
    });
    expect(componentProps(status).options).toEqual(
      getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
    );
    expect(parseableRule(status.rules).safeParse(undefined)).toMatchObject({
      data: CommonStatusEnum.ENABLE,
      success: true,
    });
  });
});

describe('重置密码表单字段', /** 校验决定用户能否把密码改成无效值或原值。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让用户无法完成重置。 */ () => {
    expect(
      useResetPasswordFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(RESET_FIELDS);
  });

  it('主键字段隐藏且两个密码框复用密码组件', /** 主键可见会让用户误改记录标识，未复用密码组件会缺少强度提示。 */ () => {
    const schema = useResetPasswordFormSchema();

    expect(fieldDependencies(findField(schema, 'id')).show?.({})).toBe(false);
    for (const fieldName of ['newPassword', 'confirmPassword']) {
      const field = findField(schema, fieldName);
      expect(field.component).toBe('VbenInputPassword');
      expect(field.rules).toBe('required');
      expect(componentProps(field).passwordStrength).toBe(true);
    }
    expect(componentProps(findField(schema, 'newPassword')).placeholder).toBe(
      '请输入新密码',
    );
  });

  it('确认密码沿用登录页的确认密码语言键', /** 语言键写错会让确认密码框显示原始键名或空白。 */ () => {
    expect(
      componentProps(findField(useResetPasswordFormSchema(), 'confirmPassword'))
        .placeholder,
    ).toBe($t('authentication.confirmPassword'));
  });

  it('新密码校验长度区间并拒绝与旧密码相同', /** 缺少长度与差异校验会让用户把密码改成过短值或原值。 */ () => {
    const newPassword = findField(useResetPasswordFormSchema(), 'newPassword');
    const resolve = fieldDependencies(newPassword).rules;
    const dependencies = fieldDependencies(newPassword);

    expect(dependencies.triggerFields).toEqual(['newPassword', 'oldPassword']);
    expect(typeof resolve).toBe('function');
    const rule = resolve?.({ oldPassword: 'DUMMY-old-password' });

    expect(firstIssueMessage(rule, '1234')).toBe('密码长度不能少于 5 个字符');
    expect(firstIssueMessage(rule, 'x'.repeat(21))).toBe(
      '密码长度不能超过 20 个字符',
    );
    expect(firstIssueMessage(rule, 'DUMMY-old-password')).toBe(
      '新旧密码不能相同',
    );
    expect(passesRule(rule, 'DUMMY-new-password')).toBe(true);
  });

  it('确认密码校验长度区间并要求与新密码一致', /** 缺少一致性校验会让用户提交与输入不符的确认密码。 */ () => {
    const confirm = findField(useResetPasswordFormSchema(), 'confirmPassword');
    const dependencies = fieldDependencies(confirm);

    expect(dependencies.triggerFields).toEqual([
      'newPassword',
      'confirmPassword',
    ]);
    const rule = dependencies.rules?.({ newPassword: 'DUMMY-new-password' });

    expect(firstIssueMessage(rule, '1234')).toBe('密码长度不能少于 5 个字符');
    expect(firstIssueMessage(rule, 'DUMMY-other-password')).toBe(
      '新密码和确认密码不一致',
    );
    expect(passesRule(rule, 'DUMMY-new-password')).toBe(true);
  });
});

describe('分配角色表单字段', /** 字段与置灰决定角色分配结果。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让管理员无法完成角色分配。 */ () => {
    expect(
      useAssignRoleFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(ASSIGN_FIELDS);
  });

  it('用户名与昵称只读回显', /** 可编辑会让管理员在授权时改错用户身份。 */ () => {
    const schema = useAssignRoleFormSchema();

    expect(componentProps(findField(schema, 'username'))).toEqual({
      disabled: true,
    });
    expect(componentProps(findField(schema, 'nickname'))).toEqual({
      disabled: true,
    });
    expect(fieldDependencies(findField(schema, 'id')).show?.({})).toBe(false);
  });

  it('角色下拉绑定角色接口并按状态置灰', /** 未绑定接口会让管理员选不到角色，未置灰会让已停用角色仍可分配。 */ async () => {
    const roleIds = findField(useAssignRoleFormSchema(), 'roleIds');
    const props = componentProps(roleIds);

    expect(roleIds).toMatchObject({ component: 'ApiSelect', label: '角色' });
    expect(props).toMatchObject({
      labelField: 'name',
      multiple: true,
      placeholder: '请选择角色',
      valueField: 'id',
    });
    expect(props.api).toBe(getSimpleRoleList);
    await expect(
      (props.afterFetch as ListMapper)(ROLE_FIXTURE),
    ).resolves.toEqual([
      {
        disabled: false,
        id: 21,
        name: '管理员',
        status: CommonStatusEnum.ENABLE,
      },
      {
        disabled: true,
        id: 22,
        name: '停用角色',
        status: CommonStatusEnum.DISABLE,
      },
    ]);
  });
});

describe('用户导入表单字段', /** 字段决定导入文件与覆盖策略能否提交。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让管理员无法选择文件或覆盖策略。 */ () => {
    expect(
      useImportFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(IMPORT_FIELDS);
  });

  it('文件字段为必填并限定表格格式', /** 缺少必填会让空提交通过，缺少说明会让管理员上传错误格式。 */ () => {
    const file = findField(useImportFormSchema(), 'file');

    expect(file).toMatchObject({
      component: 'Upload',
      fieldName: 'file',
      help: '仅允许导入 xls、xlsx 格式文件',
      label: '用户数据',
      rules: 'required',
    });
  });

  it('覆盖策略默认不覆盖', /** 默认覆盖会让导入直接改写已有用户数据。 */ () => {
    const updateSupport = findField(useImportFormSchema(), 'updateSupport');

    expect(updateSupport).toMatchObject({
      component: 'Switch',
      help: '是否更新已经存在的用户数据',
      label: '是否覆盖',
    });
    expect(componentProps(updateSupport)).toEqual({
      checkedChildren: '是',
      unCheckedChildren: '否',
    });
    expect(
      parseableRule(updateSupport.rules).safeParse(undefined),
    ).toMatchObject({ data: false, success: true });
  });
});

describe('用户列表搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明用户名、手机号与创建时间筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (row) => row.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('文本筛选可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    const schema = useGridFormSchema();

    expect(componentProps(findField(schema, 'username'))).toEqual({
      clearable: true,
      placeholder: '请输入用户名称',
    });
    expect(componentProps(findField(schema, 'mobile'))).toEqual({
      clearable: true,
      placeholder: '请输入手机号码',
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

describe('用户列表列定义', /** 列定义决定用户看到的字段与状态切换入口。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('首列是复选框且操作列固定在最右', /** 缺少复选框列会让用户无法批量操作，操作列不固定会随横向滚动消失。 */ () => {
    const columns = gridColumns();
    const actions = columns.at(-1);

    expect(columns[0]).toMatchObject({ type: 'checkbox', width: 40 });
    expect(actions).toMatchObject({
      fixed: 'right',
      title: '操作',
      width: 180,
    });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });

  it('状态列把切换回调透传给单元格并声明字典值', /** 未透传回调会让管理员无法在列表内改状态，字典值写错会让开关方向相反。 */ () => {
    const onStatusChange = vi.fn(
      /** 记录列表内改状态时收到的行数据。 */ async () => true,
    );
    const status = findColumn(gridColumns(onStatusChange), 'status');
    const render = cellRender(status);

    expect(status).toMatchObject({
      align: 'center',
      minWidth: 100,
      title: '状态',
    });
    expect(render.name).toBe('CellSwitch');
    expect(render.props).toEqual({
      activeValue: CommonStatusEnum.ENABLE,
      inactiveValue: CommonStatusEnum.DISABLE,
    });
    expect(
      (render.attrs as undefined | { beforeChange?: unknown })?.beforeChange,
    ).toBe(onStatusChange);
  });

  it('未声明切换回调时单元格不注入空回调', /** 注入空回调会让开关看起来可切换但实际不生效。 */ () => {
    const render = cellRender(findColumn(gridColumns(), 'status'));

    expect(
      (render.attrs as undefined | { beforeChange?: unknown })?.beforeChange,
    ).toBeUndefined();
  });

  it('创建时间列挂载真实格式化器', /** 缺少格式化会让用户看到时间戳。 */ () => {
    expect(findColumn(gridColumns(), 'createTime')).toMatchObject({
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '创建时间',
    });
  });
});

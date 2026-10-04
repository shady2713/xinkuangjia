/**
 * 菜单管理页元数据（views/system/menu/data）真实行为回归。
 *
 * 该模块向菜单表单与列表提供字段与列定义：主键字段不隐藏会让用户误改记录标识；上级菜单
 * 选项未补顶级占位会让用户无法把菜单挂到根节点；按菜单类型联动展示字段写错会让按钮类型
 * 出现图标、路径等无关项，或让菜单类型缺少组件地址；路由地址的相对/绝对校验写反会让
 * 顶级菜单存成相对路径、子菜单存成绝对路径；组件名称候选未按关键字过滤会让自动完成给出
 * 全量选项；列定义漏项或字典类型写错会让列表显示原始字典值。
 *
 * 用例真实调用每个导出函数与每个联动回调，只替换网络边界（菜单列表）与翻译边界：两者
 * 都是外部输入，其余拼装、过滤与校验规则保持真实实现。
 */

import type { VbenFormSchema } from '#/adapter/form';
import type { SystemMenuApi } from '#/api/system/menu';

import { DICT_TYPE, SystemMenuTypeEnum } from '@vben/constants';
import { IconifyIcon } from '@vben/icons';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMenuList } from '#/api/system/menu';
import { componentKeys } from '#/router/routes';

import { useFormSchema, useGridColumns } from './data';

vi.mock(
  '#/api/system/menu',
  /** 只替换网络收发边界，菜单树的拼装与顶级占位保持真实实现。 */ () => ({
    getMenuList: vi.fn(),
  }),
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对过滤与展示同时使用原名与译文。 */ () => ({
    /**
     * 把语言键拼成可预期的译文。
     * @param key 组件请求的语言键。
     * @returns 带前缀的译文。
     */
    $t: (key: string) => `译文:${key}`,
  }),
);

/** 菜单表单的字段顺序，决定新增与编辑弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'parentId',
  'name',
  'type',
  'icon',
  'path',
  'component',
  'componentName',
  'permission',
  'sort',
  'status',
  'visible',
  'alwaysShow',
  'keepAlive',
];

/** 表格列的业务字段顺序，最后一项是没有 field 的操作列。 */
const COLUMN_FIELDS = [
  'name',
  'type',
  'sort',
  'permission',
  'path',
  'componentName',
  'status',
  undefined,
];

/** 菜单树夹具：两级父子关系用于验证真实树拼装与顶级占位。 */
const MENU_FIXTURE = [
  { id: 1, name: 'DUMMY-系统管理', parentId: 0 },
  { id: 2, name: 'DUMMY-菜单管理', parentId: 1 },
];

/** 字段显示条件：按当前表单值判断字段是否渲染。 */
type ShowPredicate = (values: Record<string, unknown>) => boolean;

/** 路由地址规则函数：按当前表单值返回该位置适用的校验规则。 */
type PathRulesBuilder = (values: Record<string, unknown>) => unknown;

/** 上级菜单选项接口：返回按父子关系拼装好的菜单树。 */
type ParentApi = () => Promise<unknown>;

/** 字段依赖配置：声明触发重新计算的字段、显示条件与动态规则。 */
interface FieldDependencies {
  /** 判断字段当前是否显示；返回 false 时字段被隐藏。 */
  show?: ShowPredicate;
  /** 按联动值返回校验规则。 */
  rules?: PathRulesBuilder;
  /** 触发重新计算的字段名列表，空串表示任意字段变化。 */
  triggerFields?: string[];
}

/** 树节点过滤函数：按关键字判断节点是否命中。 */
type FilterTreeNode = (input: string, node: Record<string, unknown>) => boolean;

/** 自动完成候选回调：控件按关键字过滤后回传候选列表。 */
type SuggestionCallback = (options: { value: string }[]) => void;

/** 自动完成取候选函数：控件按关键字请求候选项。 */
type FetchSuggestions = (queryString: string, cb: SuggestionCallback) => void;

/** 具名插槽渲染表：树选择项把插槽名映射到渲染函数。 */
interface SlotRenderers {
  /** 渲染树选择项的插槽。 */
  title?: (slotProps?: Record<string, unknown>) => unknown;
}

/** 组件渲染内容函数：返回具名插槽到渲染函数的映射。 */
type RenderComponentContent = () => SlotRenderers;

/** 校验规则视图：只读取用例断言需要的成功标记与失败信息。 */
interface RuleSchema {
  /** 校验入口，返回是否成功以及失败原因。 */
  safeParse: (value: unknown) => {
    /** 失败时的错误集合。 */
    error?: { issues: { message: string }[] };
    /** 是否通过校验。 */
    success: boolean;
  };
}

/** 渲染节点视图：只读取用例断言需要的类型、属性与子节点。 */
interface RenderNode {
  /** 节点的组件类型或标签名。 */
  type?: unknown;
  /** 节点声明的属性。 */
  props?: Record<string, unknown>;
  /** 节点的子节点。 */
  children?: unknown;
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
 * 取出字段的显示条件。
 * @param item 表单字段定义。
 * @returns 显示条件函数。
 * @throws TypeError 字段未声明显示条件时抛出，避免用例静默地什么都不验证。
 */
function showOf(item: unknown) {
  const show = fieldDependencies(item).show;
  if (typeof show !== 'function') {
    throw new TypeError('字段未声明显示条件');
  }
  return show;
}

/**
 * 取出路由地址字段的动态规则函数。
 * @returns 规则函数。
 * @throws TypeError 字段未声明动态规则时抛出，避免用例静默地什么都不验证。
 */
function pathRules() {
  const rules = fieldDependencies(findField(useFormSchema(), 'path')).rules;
  if (typeof rules !== 'function') {
    throw new TypeError('路由地址字段未声明动态规则');
  }
  return rules;
}

/**
 * 取出上级菜单字段的树节点过滤函数。
 * @returns 树节点过滤函数。
 * @throws TypeError 字段未声明过滤函数时抛出，避免用例静默地什么都不验证。
 */
function filterTreeNode() {
  const filter = componentProps(
    findField(useFormSchema(), 'parentId'),
  ).filterTreeNode;
  if (typeof filter !== 'function') {
    throw new TypeError('上级菜单字段未声明树节点过滤函数');
  }
  return filter as FilterTreeNode;
}

/**
 * 取出上级菜单字段的选项接口。
 * @returns 返回菜单树数据的接口函数。
 * @throws TypeError 字段未声明接口时抛出，避免用例静默地什么都不验证。
 */
function parentApi() {
  const api = componentProps(findField(useFormSchema(), 'parentId')).api;
  if (typeof api !== 'function') {
    throw new TypeError('上级菜单字段未声明选项接口');
  }
  return api as ParentApi;
}

/**
 * 取出上级菜单字段的插槽渲染函数表。
 * @returns 插槽渲染函数表。
 * @throws TypeError 字段未声明渲染内容时抛出，避免用例静默地什么都不验证。
 */
function parentSlotRenderers() {
  const render = (
    findField(useFormSchema(), 'parentId') as
      | undefined
      | {
          renderComponentContent?: unknown;
        }
  )?.renderComponentContent;
  if (typeof render !== 'function') {
    throw new TypeError('上级菜单字段未声明渲染内容');
  }
  return (render as RenderComponentContent)();
}

/**
 * 取出组件名称字段的候选接口。
 * @returns 按关键字取候选项的函数。
 * @throws TypeError 字段未声明候选接口时抛出，避免用例静默地什么都不验证。
 */
function fetchSuggestions() {
  const fetch = componentProps(
    findField(useFormSchema(), 'componentName'),
  ).fetchSuggestions;
  if (typeof fetch !== 'function') {
    throw new TypeError('组件名称字段未声明候选接口');
  }
  return fetch as FetchSuggestions;
}

/**
 * 取出路由地址规则返回的校验对象。
 * @param values 联动时刻的表单值。
 * @returns 可执行校验的规则对象。
 * @throws TypeError 规则未返回可校验对象时抛出，避免断言落到 undefined。
 */
function ruleOf(values: Record<string, unknown>) {
  const rule = pathRules()(values);
  if (!rule || typeof (rule as RuleSchema).safeParse !== 'function') {
    throw new TypeError('路由地址规则未返回可校验对象');
  }
  return rule as RuleSchema;
}

/**
 * 读取校验失败的第一条信息。
 * @param schema 校验规则对象。
 * @param value 待校验的路由地址。
 * @returns 第一条失败信息；校验通过时返回空串。
 */
function firstIssue(schema: RuleSchema, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) {
    return '';
  }
  return result.error?.issues[0]?.message ?? '';
}

/**
 * 收集自动完成的候选项。
 * @param queryString 自动完成框当前的关键字。
 * @returns 控件回调收到的候选项列表。
 */
function suggestionsOf(queryString: string) {
  let received: { value: string }[] = [];
  fetchSuggestions()(
    queryString,
    /** 记录控件回传的候选项。 */ (options: { value: string }[]) => {
      received = options;
    },
  );
  return received;
}

/**
 * 读取渲染节点的子节点数组。
 * @param node 渲染节点。
 * @returns 子节点数组；没有子节点时返回空数组。
 */
function childrenOf(node: unknown) {
  const children = (node as RenderNode | undefined)?.children;
  return Array.isArray(children) ? (children as RenderNode[]) : [];
}

/**
 * 取出表格列定义。
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
 * 按字段名取出表格列定义。
 * @param field 列对应的业务字段。
 * @returns 命中的列定义。
 * @throws Error 找不到该列时抛出，避免用例静默地什么都不验证。
 */
function findColumn(field: string) {
  const column = gridColumns().find(
    /** 只挑出目标列，其余列与本断言无关。 */ (item) => item.field === field,
  );
  if (!column) {
    throw new Error(`列表缺少列：${field}`);
  }
  return column;
}

beforeEach(
  /** 每例重建字典缓存，让菜单类型与状态走真实取值链路。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.COMMON_STATUS]: [
        { label: '开启', value: '0' },
        { label: '关闭', value: '1' },
      ],
      [DICT_TYPE.SYSTEM_MENU_TYPE]: [
        { label: '目录', value: '1' },
        { label: '菜单', value: '2' },
        { label: '按钮', value: '3' },
      ],
    });
    // 夹具只保留组件实际读取的菜单字段，按接口类型断言后交给真实树拼装。
    vi.mocked(getMenuList).mockResolvedValue(
      MENU_FIXTURE as unknown as SystemMenuApi.Menu[],
    );
  },
);

describe('菜单表单字段', /** 字段与联动决定菜单能否正确登记与修改。 */ () => {
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
    expect(showOf(id)({})).toBe(false);
  });

  it('上级菜单补齐顶级占位并拼成真实树', /** 缺少顶级占位会让用户无法把菜单挂到根节点。 */ async () => {
    const field = findField(useFormSchema(), 'parentId');
    const props = componentProps(field);

    expect(field).toMatchObject({
      component: 'ApiTreeSelect',
      label: '上级菜单',
      rules: 'selectRequired',
    });
    expect(props).toMatchObject({
      checkStrictly: true,
      childrenField: 'children',
      clearable: true,
      defaultExpandedKeys: [0],
      labelField: 'name',
      placeholder: '请选择上级菜单',
      showSearch: true,
      valueField: 'id',
    });

    const tree = (await parentApi()()) as Array<{
      children?: unknown[];
      id?: number;
      name?: string;
    }>;

    expect(getMenuList).toHaveBeenCalledWith();
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: 0, name: '顶级部门' });
    expect(tree[0]?.children).toHaveLength(1);
  });

  it('上级菜单按名称与译文过滤节点', /** 过滤写错会让用户搜不到菜单，或把无关节点全部显示出来。 */ () => {
    const filter = filterTreeNode();

    expect(filter('', {})).toBe(true);
    expect(filter('菜单', { label: 'DUMMY-菜单管理' })).toBe(true);
    expect(filter('不存在', { label: 'DUMMY-菜单管理' })).toBe(false);
    expect(filter('菜单', {})).toBe(false);
    // 名称本身不含关键字，但翻译后的文本命中，说明两个口径都被使用。
    expect(filter('译文', { label: 'system.menu' })).toBe(true);
  });

  it('上级菜单插槽按有无图标组装展示节点', /** 未按图标组装会让带图标的菜单在树里丢失图标。 */ () => {
    const renderers = parentSlotRenderers();
    const title = renderers.title;
    if (typeof title !== 'function') {
      throw new TypeError('上级菜单未声明标题插槽');
    }

    expect(title()).toBe('');
    const plain = title({ label: 'DUMMY-菜单管理' });
    const plainChildren = childrenOf(plain);
    expect(plainChildren).toHaveLength(1);
    expect(plainChildren[0]).toMatchObject({
      children: '译文:DUMMY-菜单管理',
      type: 'span',
    });

    const withIcon = title({ icon: 'carbon:home', label: 'DUMMY-菜单管理' });
    const iconChildren = childrenOf(withIcon);
    expect(iconChildren).toHaveLength(2);
    expect(iconChildren[0]).toMatchObject({
      props: { class: 'size-4', icon: 'carbon:home' },
      type: IconifyIcon,
    });
    expect((withIcon as RenderNode).props).toEqual({
      class: 'flex items-center gap-1',
    });
  });

  it('菜单类型取自字典并默认目录', /** 字典类型写错会让类型单选为空，默认值缺失会让新增菜单没有类型。 */ () => {
    const field = findField(useFormSchema(), 'type');

    expect(field).toMatchObject({
      component: 'RadioGroup',
      label: '菜单类型',
    });
    expect(componentProps(field).options).toEqual([
      { label: '目录', value: 1 },
      { label: '菜单', value: 2 },
      { label: '按钮', value: 3 },
    ]);
    const rules = field.rules as RuleSchema | undefined;
    expect(rules?.safeParse(undefined)).toMatchObject({
      data: SystemMenuTypeEnum.DIR,
      success: true,
    });
  });

  it('图标只对目录与菜单展示', /** 按钮类型出现图标会让用户以为按钮有页面跳转。 */ () => {
    const icon = findField(useFormSchema(), 'icon');
    const show = showOf(icon);

    expect(icon).toMatchObject({
      component: 'IconPicker',
      label: '菜单图标',
      rules: 'required',
    });
    expect(componentProps(icon)).toMatchObject({
      placeholder: '请选择菜单图标',
      prefix: 'carbon',
    });
    expect(fieldDependencies(icon).triggerFields).toEqual(['type']);
    expect(show({ type: SystemMenuTypeEnum.DIR })).toBe(true);
    expect(show({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(show({ type: SystemMenuTypeEnum.BUTTON })).toBe(false);
    expect(show({})).toBe(false);
    expect(show({ type: '1' })).toBe(false);
  });

  it('路由地址按父级位置校验斜杠规则', /** 相对与绝对路径校验写反会让菜单存成打不开的地址。 */ () => {
    const path = findField(useFormSchema(), 'path');

    expect(path).toMatchObject({ component: 'Input', label: '路由地址' });
    expect(componentProps(path).placeholder).toBe('请输入路由地址');
    expect(fieldDependencies(path).triggerFields).toEqual(['type', 'parentId']);
    expect(showOf(path)({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(showOf(path)({ type: SystemMenuTypeEnum.BUTTON })).toBe(false);

    // 顶级菜单必须是绝对路径。
    const topLevel = ruleOf({ parentId: 0, path: 'user' });
    expect(firstIssue(topLevel, 'user')).toBe('路径必须以 / 开头');
    expect(topLevel.safeParse('/user').success).toBe(true);
    // 非顶级菜单必须是相对路径。
    const childLevel = ruleOf({ parentId: 1, path: 'user' });
    expect(firstIssue(childLevel, '/user')).toBe('路径不能以 / 开头');
    expect(childLevel.safeParse('user').success).toBe(true);
    // 外网地址不受斜杠规则约束。
    expect(
      ruleOf({ parentId: 0, path: 'https://example.com' }).safeParse(
        'https://example.com',
      ).success,
    ).toBe(true);
    // 空地址与缺失类型都按空串处理，先命中必填校验。
    expect(firstIssue(ruleOf({ parentId: 0, path: '' }), '')).toBe(
      '路由地址不能为空',
    );
    // 地址不是字符串时按空串参与联动，父级缺失则落到相对路径规则。
    expect(firstIssue(ruleOf({ path: 123 }), '/user')).toBe(
      '路径不能以 / 开头',
    );
  });

  it('组件地址与组件名称只对菜单类型展示', /** 目录与按钮出现组件字段会让用户填出无效配置。 */ () => {
    const component = findField(useFormSchema(), 'component');
    const componentName = findField(useFormSchema(), 'componentName');

    expect(component).toMatchObject({ component: 'Input', label: '组件地址' });
    expect(showOf(component)({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(showOf(component)({ type: SystemMenuTypeEnum.DIR })).toBe(false);
    expect(componentName).toMatchObject({
      component: 'AutoComplete',
      label: '组件名称',
    });
    expect(showOf(componentName)({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(showOf(componentName)({ type: SystemMenuTypeEnum.BUTTON })).toBe(
      false,
    );
  });

  it('组件名称候选按关键字忽略大小写过滤', /** 未过滤会让自动完成给出全量候选，用户无法快速定位组件。 */ () => {
    const all = suggestionsOf('');

    expect(all).toHaveLength(componentKeys.length);
    expect(all).toContainEqual({ value: '/system/menu/index' });

    const filtered = suggestionsOf('MENU/INDEX');
    expect(filtered.length).toBeGreaterThan(0);
    for (const option of filtered) {
      expect(option.value.toLowerCase()).toContain('menu/index');
    }

    expect(suggestionsOf('DUMMY-不存在组件')).toEqual([]);
  });

  it('权限标识只对按钮与菜单展示', /** 目录出现权限标识会让用户以为目录可以单独授权。 */ () => {
    const permission = findField(useFormSchema(), 'permission');
    const show = showOf(permission);

    expect(permission).toMatchObject({ component: 'Input', label: '权限标识' });
    expect(show({ type: SystemMenuTypeEnum.BUTTON })).toBe(true);
    expect(show({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(show({ type: SystemMenuTypeEnum.DIR })).toBe(false);
    expect(show({})).toBe(false);
  });

  it('排序、状态与显示开关声明默认值与联动', /** 默认值缺失会让新增菜单状态异常，联动写错会让按钮出现无关开关。 */ () => {
    const sort = findField(useFormSchema(), 'sort');
    const status = findField(useFormSchema(), 'status');
    const visible = findField(useFormSchema(), 'visible');
    const alwaysShow = findField(useFormSchema(), 'alwaysShow');
    const keepAlive = findField(useFormSchema(), 'keepAlive');

    expect(sort).toMatchObject({
      component: 'InputNumber',
      label: '显示顺序',
      rules: 'required',
    });
    expect(componentProps(sort)).toMatchObject({ min: 0 });
    expect(componentProps(status).options).toEqual([
      { label: '开启', value: 0 },
      { label: '关闭', value: 1 },
    ]);
    expect(visible.defaultValue).toBe(true);
    expect(alwaysShow.defaultValue).toBe(true);
    expect(keepAlive.defaultValue).toBe(true);
    expect(showOf(visible)({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(showOf(visible)({ type: SystemMenuTypeEnum.BUTTON })).toBe(false);
    expect(showOf(alwaysShow)({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(showOf(alwaysShow)({ type: SystemMenuTypeEnum.DIR })).toBe(false);
    expect(showOf(keepAlive)({ type: SystemMenuTypeEnum.MENU })).toBe(true);
    expect(showOf(keepAlive)({ type: SystemMenuTypeEnum.DIR })).toBe(false);
    expect(status.rules).toMatchObject({
      safeParse: expect.any(Function),
    });
  });
});

describe('菜单列表列定义', /** 列定义决定用户看到的字段与字典展示。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('名称列作为树节点固定在左侧', /** 未标记树节点会让子菜单平铺显示，不固定会让层级随滚动消失。 */ () => {
    expect(findColumn('name')).toMatchObject({
      align: 'left',
      field: 'name',
      fixed: 'left',
      minWidth: 250,
      slots: { default: 'name' },
      title: '菜单名称',
      treeNode: true,
    });
  });

  it('类型与状态列挂载对应字典单元格', /** 字典类型写错会让列表显示原始字典值。 */ () => {
    expect(findColumn('type')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_MENU_TYPE },
      },
      minWidth: 100,
      title: '菜单类型',
    });
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      minWidth: 100,
      title: '状态',
    });
  });

  it('操作列固定在最右并使用具名插槽', /** 操作列不固定会随横向滚动消失，插槽写错会让操作按钮渲染为空。 */ () => {
    const actions = gridColumns().at(-1);

    expect(actions).toMatchObject({
      fixed: 'right',
      title: '操作',
      width: 220,
    });
    expect(actions?.slots).toEqual({ default: 'actions' });
    expect(findColumn('permission').minWidth).toBe(200);
    expect(findColumn('path').title).toBe('组件路径');
    expect(findColumn('componentName').title).toBe('组件名称');
    expect(findColumn('sort').title).toBe('显示排序');
  });
});

describe('菜单表单展示节点', /** 展示节点决定树选择项在页面上的可读性。 */ () => {
  it('无图标时不渲染图标节点', /** 多渲染空图标会让树节点出现空白占位。 */ () => {
    const title = parentSlotRenderers().title;
    if (typeof title !== 'function') {
      throw new TypeError('上级菜单未声明标题插槽');
    }
    const node = title({ label: 'DUMMY-菜单管理' });

    expect(
      childrenOf(node).some(
        /** 判断子节点里是否出现图标组件。 */ (child) =>
          child.type === IconifyIcon,
      ),
    ).toBe(false);
  });
});

/**
 * OAuth2 客户端元数据（views/system/oauth2/client/data）真实行为回归。
 *
 * 该模块向客户端表单与客户端列表提供字段与列定义：主键字段不隐藏会让用户误改记录
 * 标识；授权类型未多选会让客户端只能申请一种授权；自动授权范围未按已选授权范围联动
 * 会让管理员填出范围外的值；有效期列缺少格式化会让管理员读到裸秒数；操作列不固定在
 * 右侧会随横向滚动消失。
 *
 * 用例真实调用每个导出函数，并真实执行返回结构里的联动函数与列格式化器；有效期列另用真实
 * vxe-table 渲染表体，核对列表里实际显示的文本。用例只替换字典缓存边界，表格与上传组件保持
 * 真实引用。
 */
import type { VbenFormSchema } from '#/adapter/form';

import { mount } from '@vue/test-utils';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useVbenVxeGrid } from '#/adapter/vxe-table';

import { useFormSchema, useGridColumns, useGridFormSchema } from './data';

/** 有效期夹具：访问令牌 3600 秒、刷新令牌 86400 秒，都是后端真实口径的整数秒。 */
const VALIDITY_SECONDS = { access: 3600, refresh: 86_400 };

/** 客户端表单的字段顺序，决定新增与修改弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'clientId',
  'secret',
  'name',
  'logo',
  'description',
  'status',
  'accessTokenValiditySeconds',
  'refreshTokenValiditySeconds',
  'authorizedGrantTypes',
  'scopes',
  'autoApproveScopes',
  'redirectUris',
  'authorities',
  'resourceIds',
  'additionalInformation',
];

/** 列表搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['name', 'status'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'clientId',
  'secret',
  'name',
  'logo',
  'status',
  'accessTokenValiditySeconds',
  'refreshTokenValiditySeconds',
  'authorizedGrantTypes',
  'createTime',
  undefined,
];

/** 列格式化器入参：vxe-table 以单元格参数对象调用列上的 formatter。 */
interface CellFormatParams {
  /** 单元格原始取值。 */
  cellValue: unknown;
}

/** 列格式化器签名：按单元格参数对象返回展示文本。 */
type ColumnFormatter = (params: CellFormatParams) => unknown;

/** 字段显示条件：按当前表单值判断字段是否渲染。 */
type ShowPredicate = (values: Record<string, unknown>) => boolean;

/** 字段属性联动函数：按当前表单值返回要合并进组件属性的部分。 */
type ComponentPropsResolver = (
  values: Record<string, unknown>,
) => Record<string, unknown>;

/** 字段依赖配置：声明触发重新计算的字段与属性联动函数。 */
interface FieldDependencies {
  /** 按当前表单值计算组件属性。 */
  componentProps?: ComponentPropsResolver;
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

/**
 * 取出列上声明的格式化函数。
 * @param field 列的 field 值。
 * @returns 列声明的格式化函数。
 * @throws TypeError 列未声明函数式格式化器时抛出，避免用例静默地什么都不验证。
 */
function columnFormatter(field: string) {
  const formatter = findColumn(field).formatter;
  if (typeof formatter !== 'function') {
    throw new TypeError(`列 ${field} 未声明函数式格式化器`);
  }
  return formatter as unknown as ColumnFormatter;
}

beforeEach(
  /** 每例重建字典缓存，让状态与授权类型字典走真实取值链路。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.COMMON_STATUS]: [
        { label: '开启', value: '0' },
        { label: '关闭', value: '1' },
      ],
      [DICT_TYPE.SYSTEM_OAUTH2_GRANT_TYPE]: [
        { label: '授权码', value: 'authorization_code' },
        { label: '刷新令牌', value: 'refresh_token' },
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

describe('客户端表单字段', /** 字段与联动决定客户端能否正确注册与修改。 */ () => {
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

  it('编号、密钥、应用名、图标与令牌有效期为必填', /** 缺少必填会让不完整客户端落库并在授权时失败。 */ () => {
    const schema = useFormSchema();

    for (const fieldName of [
      'clientId',
      'secret',
      'name',
      'logo',
      'accessTokenValiditySeconds',
      'refreshTokenValiditySeconds',
      'authorizedGrantTypes',
      'redirectUris',
    ]) {
      expect(findField(schema, fieldName).rules).toBe('required');
    }
    expect(findField(schema, 'logo').component).toBe('ImageUpload');
  });

  it('状态取自状态字典并默认启用', /** 字典类型写错会让状态选项为空，默认值写错会让新客户端默认停用。 */ () => {
    const status = findField(useFormSchema(), 'status');

    expect(status).toMatchObject({ component: 'RadioGroup', label: '状态' });
    expect(componentProps(status).options).toEqual([
      { label: '开启', value: 0 },
      { label: '关闭', value: 1 },
    ]);
    const rule = status.rules as DefaultValueRule;
    expect(rule.parse(undefined)).toBe(CommonStatusEnum.ENABLE);
  });

  it('授权类型取授权类型字典并允许多选', /** 字典类型写错会让管理员选不到授权类型，未多选会让客户端只能申请一种授权。 */ () => {
    const grants = findField(useFormSchema(), 'authorizedGrantTypes');

    expect(grants).toMatchObject({ component: 'Select', label: '授权类型' });
    expect(componentProps(grants)).toEqual({
      multiple: true,
      options: [
        { label: '授权码', value: 'authorization_code' },
        { label: '刷新令牌', value: 'refresh_token' },
      ],
      placeholder: '请输入授权类型',
    });
  });

  it('自动授权范围按已选授权范围联动', /** 未联动会让管理员填出范围外的自动授权值。 */ () => {
    const autoApprove = findField(useFormSchema(), 'autoApproveScopes');
    const dependencies = fieldDependencies(autoApprove);
    const resolve = dependencies.componentProps;

    expect(autoApprove).toMatchObject({
      component: 'Select',
      label: '自动授权范围',
    });
    expect(componentProps(autoApprove)).toEqual({
      multiple: true,
      options: [],
      placeholder: '请输入自动授权范围',
    });
    expect(dependencies.triggerFields).toEqual(['scopes']);
    expect(typeof resolve).toBe('function');
    expect(resolve?.({ scopes: ['read', 'write'] })).toEqual({
      options: [
        { label: 'read', value: 'read' },
        { label: 'write', value: 'write' },
      ],
    });
    expect(resolve?.({ scopes: [] })).toEqual({ options: [] });
    // 联动期间授权范围可能尚未选择，非数组形态按空列表处理。
    expect(resolve?.({ scopes: undefined })).toEqual({ options: [] });
    expect(resolve?.({ scopes: 'read' })).toEqual({ options: [] });
  });

  it('多值字段使用标签输入组件', /** 用单行输入会让多个 URI 或权限无法分隔录入。 */ () => {
    const schema = useFormSchema();

    for (const fieldName of [
      'scopes',
      'redirectUris',
      'authorities',
      'resourceIds',
    ]) {
      expect(findField(schema, fieldName).component).toBe('InputTag');
    }
  });
});

describe('客户端列表搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明应用名与状态筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (row) => row.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('状态筛选取自状态字典且可清空', /** 字典类型写错会让筛选下拉为空。 */ () => {
    const status = findField(useGridFormSchema(), 'status');

    expect(status).toMatchObject({ component: 'Select', label: '状态' });
    expect(componentProps(status)).toEqual({
      clearable: true,
      options: [
        { label: '开启', value: 0 },
        { label: '关闭', value: 1 },
      ],
      placeholder: '请输入状态',
    });
  });
});

describe('客户端列表列定义', /** 列定义决定用户看到的字段、字典与格式化结果。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('图标与状态列挂载真实单元格渲染器', /** 缺少单元格渲染器会让列表显示裸图片地址与原始字典值。 */ () => {
    expect(findColumn('logo')).toMatchObject({
      cellRender: { name: 'CellImage' },
      title: '应用图标',
    });
    expect(findColumn('status')).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
      title: '状态',
    });
  });

  it('两个有效期列共用同一个格式化函数', /** 只给其中一列加格式化会让两列展示口径不一致。 */ () => {
    expect(columnFormatter('accessTokenValiditySeconds')).toBe(
      columnFormatter('refreshTokenValiditySeconds'),
    );
  });

  it('有效期格式化器按 vxe 真实入参输出带单位的秒数', /** 真实缺陷回归：vxe 以 { cellValue } 参数对象调用列上的 formatter，把入参直接当秒数拼接会让两列都渲染成 “[object Object] 秒”。 */ () => {
    expect(
      columnFormatter('accessTokenValiditySeconds')({ cellValue: 3600 }),
    ).toBe('3600 秒');
    expect(
      columnFormatter('refreshTokenValiditySeconds')({ cellValue: 86_400 }),
    ).toBe('86400 秒');
  });

  it('有效期格式化器区分零值与空值', /** 0 是合法有效期（表单下限为 0），只有 null/undefined 才是空值并显示空文本。 */ () => {
    const formatter = columnFormatter('accessTokenValiditySeconds');

    expect(formatter({ cellValue: 0 })).toBe('0 秒');
    expect(formatter({ cellValue: null })).toBe('');
    expect(formatter({ cellValue: undefined })).toBe('');
  });

  it('创建时间列挂载真实格式化器', /** 缺少格式化会让用户看到时间戳。 */ () => {
    expect(findColumn('createTime')).toMatchObject({
      formatter: 'formatDateTime',
      title: '创建时间',
    });
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
});

describe('有效期列的真实表格渲染', /** 列表里显示的文本由真实表格调用格式化器产生，只核对函数入参不足以证明用户看到的内容。 */ () => {
  it('两列在真实表格中渲染带单位的秒数、空值不渲染占位文本', /** 格式化器入参写错会让两列在列表里都显示 “[object Object] 秒”，空值判断写错会显示 “null 秒”。 */ async () => {
    const columns = gridColumns().filter(
      /** 只保留两个有效期列：其余列依赖字典缓存与页面插槽，与本用例要验证的格式化调用无关。 */ (
        column,
      ) =>
        column.field === 'accessTokenValiditySeconds' ||
        column.field === 'refreshTokenValiditySeconds',
    );
    const [Grid, api] = useVbenVxeGrid({
      gridOptions: {
        columns,
        data: [
          {
            accessTokenValiditySeconds: VALIDITY_SECONDS.access,
            refreshTokenValiditySeconds: VALIDITY_SECONDS.refresh,
          },
          {
            accessTokenValiditySeconds: null,
            refreshTokenValiditySeconds: null,
          },
        ],
      },
    });
    const wrapper = mount(Grid, { attachTo: document.body, props: { api } });

    await vi.waitFor(
      /** 表格异步渲染表体，等第一行的有效期文本出现再断言。 */ () => {
        expect(wrapper.text()).toContain('3600 秒');
      },
    );

    const rows = wrapper.findAll('.vxe-body--row');
    expect(rows.at(0)?.text()).toContain('3600 秒');
    expect(rows.at(0)?.text()).toContain('86400 秒');
    // 空值行只显示空单元格，不得出现 “null 秒” 或 “undefined 秒”。
    expect(rows.at(1)?.text()).not.toContain('秒');

    wrapper.unmount();
  });
});

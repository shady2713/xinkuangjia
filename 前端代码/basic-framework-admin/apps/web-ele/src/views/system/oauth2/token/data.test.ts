/**
 * OAuth2 令牌列表元数据（views/system/oauth2/token/data）真实行为回归。
 *
 * 该模块向令牌列表页提供搜索表单与表格列定义：搜索项字段名写错会让筛选条件发不出去，
 * 用户类型下拉必须按数值型字典渲染，否则后端收到字符串枚举值会判定为非法；令牌列缺少
 * 单元格渲染器会让长令牌撑破表格，时间列缺少格式化会让用户看到时间戳。用例使用真实
 * 字典缓存与真实字典取值函数，不替换被测模块的任何实现；夹具直接写入当前活动的字典缓存。
 */
import { DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useGridColumns, useGridFormSchema } from './data';

/** 令牌列表搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['userId', 'userType', 'clientId'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'accessToken',
  'refreshToken',
  'userId',
  'userType',
  'clientId',
  'expiresTime',
  'createTime',
  undefined,
];

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
 * 播种用户类型字典缓存，使真实字典取值函数返回数值型选项。
 * @returns 无返回值；直接写入当前活动的字典缓存。
 */
function seedUserTypeDict() {
  useDictStore().setDictCache({
    [DICT_TYPE.USER_TYPE]: [
      { label: '管理员', value: '1' },
      { label: '会员', value: '2' },
    ],
  });
}

beforeEach(
  /** 每例重建字典缓存，避免上一例写入的字典影响本例断言。 */ () => {
    setActivePinia(createPinia());
    seedUserTypeDict();
  },
);

describe('令牌列表搜索表单', /** 搜索项决定筛选条件能否正确发给后端。 */ () => {
  it('按约定顺序提供用户编号、用户类型与客户端编号', /** 字段名或顺序写错会让筛选条件发不出去或落到错误字段。 */ () => {
    const schema = useGridFormSchema();

    expect(
      schema.map(
        /** 取出字段名用于核对搜索项顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
    expect(schema[0]).toMatchObject({
      component: 'Input',
      label: '用户编号',
      componentProps: { clearable: true, placeholder: '请输入用户编号' },
    });
    expect(schema[2]).toMatchObject({
      component: 'Input',
      label: '客户端编号',
      componentProps: { clearable: true, placeholder: '请输入客户端编号' },
    });
  });

  it('用户类型下拉使用数值型字典选项', /** 传字符串枚举值会被后端判定为非法用户类型。 */ () => {
    const schema = useGridFormSchema();
    const userType = schema.find(
      /** 只挑出用户类型项，其余项与本断言无关。 */ (item) =>
        item.fieldName === 'userType',
    );

    expect(userType).toMatchObject({
      component: 'Select',
      label: '用户类型',
      componentProps: { clearable: true, placeholder: '请选择用户类型' },
    });
    expect(componentProps(userType).options).toEqual([
      { label: '管理员', value: 1 },
      { label: '会员', value: 2 },
    ]);
  });

  it('字典缓存为空时用户类型选项退化为空数组', /** 字典未加载时不能编造选项，否则用户会选到无效枚举。 */ () => {
    useDictStore().setDictCache({});

    const schema = useGridFormSchema();
    const userType = schema.find(
      /** 只挑出用户类型项，其余项与本断言无关。 */ (item) =>
        item.fieldName === 'userType',
    );

    expect(componentProps(userType).options).toEqual([]);
  });
});

describe('令牌列表列定义', /** 列定义决定令牌信息能否完整、可读地展示。 */ () => {
  it('列顺序与业务字段保持一致', /** 列顺序变化会让用户按习惯找到的信息错位。 */ () => {
    const columns = gridColumns();

    expect(
      columns.map(
        /** 取出字段名用于核对列顺序；操作列没有字段名。 */
        (item) => (item as { field?: string }).field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('首列为勾选框且操作列固定在最右', /** 缺少勾选框会让批量删除不可用，操作列不固定会被横向滚动带走。 */ () => {
    const columns = gridColumns();

    expect(columns[0]).toMatchObject({ type: 'checkbox', width: 40 });
    expect(columns.at(-1)).toMatchObject({
      fixed: 'right',
      slots: { default: 'actions' },
      width: 80,
    });
  });

  it('令牌列给出足够宽度以完整展示长串', /** 宽度不足会让访问令牌与刷新令牌被截断，用户无法复制。 */ () => {
    const columns = gridColumns();
    const accessToken = columns.find(
      /** 只挑出访问令牌列，其余列与本断言无关。 */
      (item) => (item as { field?: string }).field === 'accessToken',
    );
    const refreshToken = columns.find(
      /** 只挑出刷新令牌列，其余列与本断言无关。 */
      (item) => (item as { field?: string }).field === 'refreshToken',
    );

    expect(accessToken).toMatchObject({
      title: '访问令牌',
      minWidth: 300,
    });
    expect(refreshToken).toMatchObject({
      title: '刷新令牌',
      minWidth: 300,
    });
  });

  it('用户类型列交由字典渲染器展示', /** 直接展示原始枚举值会让用户看到数字而不是类型名称。 */ () => {
    const columns = gridColumns();
    const userType = columns.find(
      /** 只挑出用户类型列，其余列与本断言无关。 */
      (item) => (item as { field?: string }).field === 'userType',
    );

    expect(userType).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.USER_TYPE },
      },
      minWidth: 100,
      title: '用户类型',
    });
  });

  it('两个时间列都使用统一的时间格式化器', /** 缺少格式化会让用户看到原始时间戳或 ISO 串。 */ () => {
    const columns = gridColumns();
    const timeColumns = columns.filter(
      /** 只挑出声明了格式化器的时间列，其余列与本断言无关。 */
      (item) =>
        ['createTime', 'expiresTime'].includes(
          String((item as { field?: string }).field),
        ),
    );

    expect(timeColumns).toHaveLength(2);
    expect(
      timeColumns.map(
        /** 只取出字段名与格式化器，核对两列口径一致。 */
        (item) => {
          const column = item as { field: string; formatter: string };
          return { field: column.field, formatter: column.formatter };
        },
      ),
    ).toEqual([
      { field: 'expiresTime', formatter: 'formatDateTime' },
      { field: 'createTime', formatter: 'formatDateTime' },
    ]);
  });

  it('用户编号与客户端编号列给出最小宽度', /** 宽度缺失会让窄屏下的列被压缩到不可读。 */ () => {
    const columns = gridColumns();
    const userId = columns.find(
      /** 只挑出用户编号列，其余列与本断言无关。 */
      (item) => (item as { field?: string }).field === 'userId',
    );
    const clientId = columns.find(
      /** 只挑出客户端编号列，其余列与本断言无关。 */
      (item) => (item as { field?: string }).field === 'clientId',
    );

    expect(userId).toMatchObject({ minWidth: 100, title: '用户编号' });
    expect(clientId).toMatchObject({ minWidth: 120, title: '客户端编号' });
  });
});

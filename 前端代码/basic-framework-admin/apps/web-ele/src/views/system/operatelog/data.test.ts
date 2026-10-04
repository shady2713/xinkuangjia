/**
 * 操作日志元数据（views/system/operatelog/data）真实行为回归。
 *
 * 该模块向操作日志页提供搜索表单、表格列与详情描述项：搜索项字段名写错会让筛选条件
 * 发不出去，操作人下拉的取值来源或字段映射写错会让下拉为空或显示成编号；时间范围缺少
 * 默认属性会让后端收到格式不符的时间串；操作时间列缺少格式化会让用户看到时间戳；
 * 详情页的操作人类型必须渲染成字典标签，否则用户看到的是裸枚举值；链路号缺失时仍显示
 * 该列会让详情出现空白行；请求地址缺少方法前缀会让运维无法判断请求方式。用例使用真实
 * 字典标签组件、真实格式化函数与真实时间范围属性，只替换用户列表接口与翻译边界。
 */
import type { VNode } from 'vue';

import { DICT_TYPE } from '@vben/constants';

import { describe, expect, it, vi } from 'vitest';

import { DictTag } from '#/components/dict-tag';

import { useDetailSchema, useGridColumns, useGridFormSchema } from './data';

/** 用户列表接口替身；用于核对操作人下拉声明的取值来源。 */
const userApiProbe = vi.hoisted(
  /** 建立可断言的用户列表接口替身。 */ () => ({ getSimpleUserList: vi.fn() }),
);

vi.mock(
  '#/api/system/user',
  /** 只替换用户列表接口边界，搜索项声明与字典渲染保持真实实现。 */ () => ({
    getSimpleUserList: userApiProbe.getSimpleUserList,
  }),
);

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

/** 操作日志搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = [
  'userId',
  'type',
  'subType',
  'action',
  'createTime',
  'bizId',
];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  'id',
  'userName',
  'type',
  'subType',
  'action',
  'createTime',
  'bizId',
  'userIp',
  undefined,
];

/** 详情描述项的字段顺序，与详情弹窗的展示顺序一致。 */
const DETAIL_FIELDS = [
  'id',
  'traceId',
  'userId',
  'userType',
  'userName',
  'userIp',
  'userAgent',
  'type',
  'subType',
  'action',
  'extra',
  'requestUrl',
  'createTime',
  'bizId',
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
 * 按业务字段取出搜索项。
 * @param field 搜索项字段名。
 * @returns 命中的搜索项定义。
 * @throws Error 找不到该搜索项时抛出，避免用例静默地什么都不验证。
 */
function findSearchItem(field: string) {
  const item = useGridFormSchema().find(
    /** 只挑出目标字段的搜索项，其余项与本断言无关。 */ (entry) =>
      entry.fieldName === field,
  );
  if (!item) {
    throw new Error(`搜索表单缺少字段：${field}`);
  }
  return item;
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
 * 按业务字段取出表格列。
 * @param field 列的 field 值。
 * @returns 命中的列定义。
 * @throws Error 找不到该列时抛出，避免用例静默地什么都不验证。
 */
function findColumn(field: string) {
  const column = gridColumns().find(
    /** 只挑出目标业务字段的列，其余列与本断言无关。 */ (entry) =>
      entry.field === field,
  );
  if (!column) {
    throw new Error(`列定义缺少字段：${field}`);
  }
  return column;
}

/**
 * 按业务字段取出详情描述项。
 * @param field 目标描述项的业务字段名。
 * @returns 命中的描述项。
 * @throws Error 找不到该描述项时抛出，避免用例静默地什么都不验证。
 */
function findDetailItem(field: string) {
  const item = useDetailSchema().find(
    /** 只挑出目标字段的描述项，其余项与本断言无关。 */ (entry) =>
      entry.field === field,
  );
  if (!item) {
    throw new Error(`详情描述项缺少字段：${field}`);
  }
  return item;
}

/**
 * 取出描述项的渲染函数。
 * @param field 目标描述项的业务字段名。
 * @returns 该描述项的渲染函数。
 * @throws TypeError 该描述项缺少渲染函数时抛出，避免用例静默地什么都不验证。
 */
function requireRender(field: string) {
  const render = findDetailItem(field).render;
  if (typeof render !== 'function') {
    throw new TypeError(`描述项缺少渲染函数：${field}`);
  }
  return render;
}

/**
 * 取出描述项的显示判定函数。
 * @param field 目标描述项的业务字段名。
 * @returns 该描述项的显示判定函数。
 * @throws TypeError 该描述项缺少显示判定函数时抛出，避免用例静默地什么都不验证。
 */
function requireShow(field: string) {
  const show = findDetailItem(field).show;
  if (typeof show !== 'function') {
    throw new TypeError(`描述项缺少显示判定函数：${field}`);
  }
  return show;
}

describe('操作日志搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明搜索项', /** 字段名或顺序写错会让筛选条件落到错误字段。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出字段名用于核对搜索项顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('操作人下拉使用真实用户列表接口与字段映射', /** 取值来源或字段映射写错会让下拉为空或显示成编号。 */ () => {
    const userId = findSearchItem('userId');

    expect(userId).toMatchObject({
      component: 'ApiSelect',
      label: '操作人',
    });
    expect(componentProps(userId)).toMatchObject({
      api: userApiProbe.getSimpleUserList,
      clearable: true,
      labelField: 'nickname',
      placeholder: '请选择操作人员',
      valueField: 'id',
    });
  });

  it('文本搜索项均可清空并给出中文占位', /** 缺少可清空标记会让用户无法撤销筛选条件。 */ () => {
    expect(findSearchItem('type')).toMatchObject({
      component: 'Input',
      label: '操作模块',
    });
    expect(componentProps(findSearchItem('type'))).toEqual({
      clearable: true,
      placeholder: '请输入操作模块',
    });
    expect(componentProps(findSearchItem('subType'))).toEqual({
      clearable: true,
      placeholder: '请输入操作名',
    });
    expect(componentProps(findSearchItem('action'))).toEqual({
      clearable: true,
      placeholder: '请输入操作内容',
    });
    expect(componentProps(findSearchItem('bizId'))).toEqual({
      clearable: true,
      placeholder: '请输入业务编号',
    });
  });

  it('操作时间沿用真实时间范围属性', /** 缺少值格式会让后端收到非约定格式的时间串。 */ () => {
    const createTime = findSearchItem('createTime');
    const props = componentProps(createTime);

    expect(createTime).toMatchObject({
      component: 'RangePicker',
      label: '操作时间',
    });
    expect(props.clearable).toBe(true);
    expect(props.format).toBe('YYYY-MM-DD HH:mm:ss');
    expect(props.valueFormat).toBe('YYYY-MM-DD HH:mm:ss');
    expect(props.startPlaceholder).toBe('译文:utils.rangePicker.beginTime');
    expect(props.endPlaceholder).toBe('译文:utils.rangePicker.endTime');
  });
});

describe('操作日志列定义', /** 列定义决定用户看到的字段、宽度与格式化结果。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('操作时间列挂载真实格式化器', /** 缺少格式化会让用户看到时间戳。 */ () => {
    expect(findColumn('createTime')).toMatchObject({
      formatter: 'formatDateTime',
      minWidth: 180,
      title: '操作时间',
    });
  });

  it('操作列固定在最右并由页面插槽渲染', /** 不固定会让操作列随横向滚动消失，插槽名写错会渲染成空白。 */ () => {
    const actions = gridColumns().at(-1);

    expect(actions).toMatchObject({ fixed: 'right', title: '操作', width: 80 });
    expect(actions?.slots).toEqual({ default: 'actions' });
  });
});

describe('操作日志详情描述项', /** 详情渲染决定用户能否读懂操作人类型、请求地址与时间。 */ () => {
  it('按约定顺序声明详情字段', /** 漏项会让详情缺少关键信息。 */ () => {
    expect(
      useDetailSchema().map(
        /** 取出详情字段名用于核对顺序。 */ (item) => item.field,
      ),
    ).toEqual(DETAIL_FIELDS);
  });

  it('链路号缺失时隐藏该描述项', /** 列表页没有链路号，仍显示会留下空白行。 */ () => {
    const show = requireShow('traceId');

    expect(show({})).toBe(true);
    expect(show({ traceId: 'DUMMY-trace-id' })).toBe(false);
    expect(show(undefined)).toBe(true);
  });

  it('扩展参数为空时隐藏该描述项', /** 空扩展参数仍显示会让详情出现空值行。 */ () => {
    const show = requireShow('extra');

    expect(show('')).toBe(true);
    expect(show(undefined)).toBe(true);
    expect(show('{"key":"DUMMY-value"}')).toBe(false);
  });

  it('操作人类型渲染为带字典类型的标签节点', /** 渲染成纯文本会让用户看到裸枚举值。 */ () => {
    const node: VNode = requireRender('userType')(2) as VNode;

    expect(node.type).toBe(DictTag);
    expect(node.props).toMatchObject({
      type: DICT_TYPE.USER_TYPE,
      value: 2,
    });
  });

  it('请求地址带请求方法前缀，缺方法时输出空串', /** 只有地址没有方法会让运维无法判断请求方式。 */ () => {
    const render = requireRender('requestUrl');

    expect(
      render('/admin-api/system/user/page', { requestMethod: 'GET' }),
    ).toBe('GET /admin-api/system/user/page');
    expect(render('/admin-api/system/user/page', {})).toBe('');
    expect(render(undefined, { requestMethod: 'GET' })).toBe('');
  });

  it('操作时间按统一格式渲染并兜底空值', /** 未格式化会显示时间戳，空值不兜底会渲染成 undefined 文本。 */ () => {
    const render = requireRender('createTime');

    expect(render('2026-03-04 05:06:07')).toBe('2026-03-04 05:06:07');
    expect(render(undefined)).toBe('');
  });
});

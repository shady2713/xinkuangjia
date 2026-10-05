/**
 * [entity-name]列表元数据（views/[module]/[entity]/data）真实行为回归。
 *
 * 字段名写错会让提交值落到错误字段；状态下拉必须按数值型字典渲染，否则后端收到字符串枚举
 * 会判定非法；隐藏的主键项缺少依赖配置会让新增表单带出主键；列定义缺少字典渲染器会让状态
 * 显示成裸数字，缺少时间格式化会让用户看到时间戳。用例使用真实字典缓存与真实字典取值函数。
 */
import { DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useFormSchema, useGridColumns, useGridFormSchema } from './data';

/** 表单字段顺序，决定新增/修改弹窗的录入顺序。 */
const FORM_FIELDS = ['id', 'name', 'status', 'remark'];

/** 搜索项字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['name', 'status'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  'id',
  'name',
  'status',
  'remark',
  'createTime',
  undefined,
];

/** 按字段名取出表单字段定义。 */
function findField(
  fields: ReturnType<typeof useFormSchema>,
  fieldName: string,
) {
  const field = fields.find(
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

/** 按业务字段取出表格列定义。 */
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
    });
  },
);

describe('[entity-name]表单字段', /** 字段名与校验决定提交数据是否正确。 */ () => {
  it('按约定顺序声明字段', /** 漏字段会让用户无法录入。 */ () => {
    expect(
      useFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(FORM_FIELDS);
  });

  it('主键字段隐藏且声明空触发字段', /** 主键可见会让用户误改记录标识。 */ () => {
    const id = findField(useFormSchema(), 'id') as {
      component?: string;
      dependencies?: { show?: () => boolean; triggerFields?: string[] };
    };

    expect(id.component).toBe('Input');
    expect(id.dependencies?.triggerFields).toEqual(['']);
    expect(id.dependencies?.show?.()).toBe(false);
  });

  it('名称为必填项', /** 漏必填会让无名称记录落库。 */ () => {
    expect(findField(useFormSchema(), 'name').rules).toBe('required');
  });

  it('状态默认开启且按数值字典渲染', /** 默认值缺失会让新增记录状态为空；字符串枚举会被后端判为非法。 */ () => {
    const status = findField(useFormSchema(), 'status') as {
      component?: string;
      componentProps?: { options?: Array<{ value: number }> };
      rules?: { safeParse: (value: unknown) => { data?: number } };
    };

    expect(status.component).toBe('RadioGroup');
    expect(status.rules?.safeParse(undefined).data).toBe(0);
    expect(status.componentProps?.options?.map((item) => item.value)).toEqual([
      0, 1,
    ]);
  });
});

describe('[entity-name]列表元数据', /** 搜索项与列定义决定筛选与展示是否可用。 */ () => {
  it('搜索项按约定顺序声明', /** 搜索项字段名写错会让后端收不到筛选条件。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出字段名用于核对顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('状态列使用字典渲染器', /** 缺少字典渲染器会让状态显示成裸数字。 */ () => {
    const status = findColumn('status') as {
      cellRender?: { name?: string; props?: { type?: string } };
    };

    expect(status.cellRender?.name).toBe('CellDict');
    expect(status.cellRender?.props?.type).toBe(DICT_TYPE.COMMON_STATUS);
  });

  it('创建时间列格式化输出', /** 缺少格式化会让用户看到原始时间戳。 */ () => {
    expect(findColumn('createTime').formatter).toBe('formatDateTime');
  });

  it('列定义按约定顺序声明操作列', /** 操作列缺失会让编辑与删除入口消失。 */ () => {
    expect(
      gridColumns().map(/** 取出列字段用于核对顺序。 */ (item) => item.field),
    ).toEqual(COLUMN_FIELDS);
  });
});

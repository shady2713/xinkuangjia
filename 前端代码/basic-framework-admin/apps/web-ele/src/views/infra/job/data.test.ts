/**
 * 定时任务元数据（views/infra/job/data）真实行为回归。
 *
 * 该模块向任务表单、任务列表与任务详情提供字段与列定义：主键字段不隐藏会让用户误改
 * 记录标识；处理器名字未按“已存在记录”置灰会让编辑时改坏已注册的处理器；CRON 表达式
 * 未绑定编辑器组件会让用户只能手写表达式；重试次数、重试间隔与监控超时缺少单位说明
 * 会让用户填错数量级；任务状态缺少字典单元格会让列表显示原始字典值；详情页的重试间隔、
 * 监控超时与后续执行时间缺少格式化会让管理员读到裸数字或空白。
 *
 * 用例真实调用每个导出函数并真实执行每个格式化回调，只替换两个重型组件（CRON 编辑器
 * 与字典标签）与字典缓存边界：按仓库既有做法（views/infra/job/modules/detail.test.ts），
 * 直接 import 会让未被渲染的 cron-tab.vue 被门禁记成“已覆盖”，属导入不等于被测试。
 */

import type { VbenFormSchema } from '#/adapter/form';
import type { DescriptionItemSchema } from '#/components/description';

import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

import { DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useDetailSchema,
  useFormSchema,
  useGridColumns,
  useGridFormSchema,
} from './data';

/** 任务表单的字段顺序，决定新增与编辑弹窗的录入顺序。 */
const FORM_FIELDS = [
  'id',
  'name',
  'handlerName',
  'handlerParam',
  'cronExpression',
  'retryCount',
  'retryInterval',
  'monitorTimeout',
];

/** 列表搜索项的字段顺序，与后端分页入参约定一致。 */
const SEARCH_FIELDS = ['name', 'status', 'handlerName'];

/** 表格列的业务字段顺序，决定用户从左到右看到的列。 */
const COLUMN_FIELDS = [
  undefined,
  'id',
  'name',
  'status',
  'handlerName',
  'handlerParam',
  'cronExpression',
  undefined,
];

/** 后续执行时间夹具：两个本地时刻，格式化结果与浏览器时区无关。 */
const NEXT_TIMES = [
  new Date(2024, 2, 4, 5, 6, 7),
  new Date(2024, 2, 5, 8, 9, 10),
];

/** 组件替身容器：记录被替换的重型组件，供用例核对适配结果。 */
const stubs = vi.hoisted(
  /** 建立 CRON 编辑器与字典标签的最小组件替身。 */ () => ({
    cronTab: { name: 'CronTabStub' },
    dictTag: { name: 'DictTagStub' },
  }),
);

vi.mock(
  '#/components/cron-tab',
  /** 只替换 CRON 编辑器组件，避免真实加载未被渲染的组件影响其它文件覆盖率判定。 */ () => ({
    CronTab: stubs.cronTab,
  }),
);

vi.mock(
  '#/components/dict-tag',
  /** 只替换字典标签组件，字典标签自身的渲染由该组件用例覆盖。 */ () => ({
    DictTag: stubs.dictTag,
  }),
);

/** 字段显示条件：按当前表单值判断字段是否渲染。 */
type ShowPredicate = (values: Record<string, unknown>) => boolean;

/** 字段禁用条件：按当前表单值判断字段是否置灰。 */
type DisabledPredicate = (values: Record<string, unknown>) => boolean;

/** 字段依赖配置：声明触发重新计算的字段、显示条件与禁用条件。 */
interface FieldDependencies {
  /** 判断字段当前是否禁用。 */
  disabled?: DisabledPredicate;
  /** 判断字段当前是否显示；返回 false 时字段被隐藏。 */
  show?: ShowPredicate;
  /** 触发重新计算的字段名列表，空串表示任意字段变化。 */
  triggerFields?: string[];
}

/** 渲染结果视图：详情项返回的节点只读取类型与属性。 */
interface RenderNode {
  /** 节点的组件类型或标签名。 */
  type?: unknown;
  /** 节点声明的属性。 */
  props?: Record<string, unknown>;
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
 * 按业务字段取出详情描述项。
 * @param fieldName 描述项对应的字段名。
 * @returns 命中的描述项定义。
 * @throws Error 找不到该描述项时抛出，避免用例静默地什么都不验证。
 */
function findDetailItem(fieldName: string) {
  const item = useDetailSchema().find(
    /** 只挑出目标业务字段，其余描述项与本断言无关。 */ (row) =>
      row.field === fieldName,
  );
  if (!item) {
    throw new Error(`详情缺少字段：${fieldName}`);
  }
  return item;
}

/**
 * 执行详情项声明的渲染回调。
 * @param item 详情描述项定义。
 * @param value 单元格原始取值。
 * @returns 渲染回调返回的节点。
 * @throws TypeError 描述项未声明渲染回调时抛出，避免用例静默地什么都不验证。
 */
function renderDetail(item: DescriptionItemSchema, value: unknown) {
  const render = item.render;
  if (typeof render !== 'function') {
    throw new TypeError(`描述项 ${item.field} 未声明渲染回调`);
  }
  return render(value) as number | RenderNode | string | undefined;
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

beforeEach(
  /** 每例重建字典缓存，让任务状态字典走真实取值链路。 */ () => {
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.INFRA_JOB_STATUS]: [
        { label: '开启', value: '1' },
        { label: '暂停', value: '2' },
      ],
    });
  },
);

describe('任务表单字段', /** 字段与联动决定任务能否正确注册与修改。 */ () => {
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

  it('处理器名字在已存在记录时置灰', /** 编辑时允许改处理器会让已注册任务指向不存在的处理器。 */ () => {
    const handlerName = findField(useFormSchema(), 'handlerName');
    const dependencies = fieldDependencies(handlerName);
    const disabled = dependencies.disabled;

    expect(handlerName).toMatchObject({
      component: 'Input',
      label: '处理器的名字',
      rules: 'required',
    });
    expect(componentProps(handlerName).placeholder).toBe('请输入处理器的名字');
    expect(dependencies.triggerFields).toEqual(['id']);
    expect(typeof disabled).toBe('function');
    expect(disabled?.({})).toBe(false);
    expect(disabled?.({ id: 7 })).toBe(true);
  });

  it('cRON 表达式绑定编辑器组件并保持原始对象', /** 未绑定编辑器会让用户只能手写表达式，未标记原始对象会让编辑器被响应式代理。 */ () => {
    const cron = findField(useFormSchema(), 'cronExpression');

    expect(cron).toMatchObject({
      component: stubs.cronTab,
      fieldName: 'cronExpression',
      label: 'CRON 表达式',
      rules: 'required',
    });
    expect(
      (cron.component as undefined | { __v_skip?: boolean })?.__v_skip,
    ).toBe(true);
    expect(componentProps(cron).placeholder).toBe('请输入 CRON 表达式');
  });

  it('重试与监控字段声明数量下限与单位说明', /** 缺少下限会让负数落库，缺少单位说明会让用户填错数量级。 */ () => {
    const schema = useFormSchema();

    expect(findField(schema, 'retryCount')).toMatchObject({
      component: 'InputNumber',
      label: '重试次数',
      rules: 'required',
    });
    expect(componentProps(findField(schema, 'retryCount'))).toMatchObject({
      class: '!w-full',
      controlsPosition: 'right',
      min: 0,
      placeholder: '请输入重试次数。设置为 0 时，不进行重试',
    });
    expect(componentProps(findField(schema, 'retryInterval')).placeholder).toBe(
      '请输入重试间隔，单位：毫秒。设置为 0 时，无需间隔',
    );
    expect(
      componentProps(findField(schema, 'monitorTimeout')).placeholder,
    ).toBe('请输入监控超时时间，单位：毫秒');
    expect(componentProps(findField(schema, 'monitorTimeout')).min).toBe(0);
  });
});

describe('任务列表搜索表单', /** 搜索项决定筛选条件能否按后端入参发出。 */ () => {
  it('按约定顺序声明名称、状态与处理器筛选', /** 字段名或顺序写错会让筛选条件发不到后端。 */ () => {
    expect(
      useGridFormSchema().map(
        /** 取出筛选字段名用于核对顺序。 */ (row) => row.fieldName,
      ),
    ).toEqual(SEARCH_FIELDS);
  });

  it('状态筛选取自任务状态字典且可清空', /** 字典类型写错会让筛选下拉为空。 */ () => {
    const status = findField(useGridFormSchema(), 'status');

    expect(status).toMatchObject({ component: 'Select', label: '任务状态' });
    expect(componentProps(status)).toEqual({
      clearable: true,
      options: [
        { label: '开启', value: 1 },
        { label: '暂停', value: 2 },
      ],
      placeholder: '请选择任务状态',
    });
  });
});

describe('任务列表列定义', /** 列定义决定用户看到的字段与字典展示。 */ () => {
  it('按约定顺序声明列', /** 漏列会让用户看不到关键字段，顺序错乱会降低可读性。 */ () => {
    expect(
      gridColumns().map(
        /** 取出列字段名用于核对顺序与占位列。 */ (column) => column.field,
      ),
    ).toEqual(COLUMN_FIELDS);
  });

  it('状态列挂载任务状态字典单元格', /** 字典类型写错会让状态列显示原始字典值。 */ () => {
    const status = gridColumns().find(
      /** 只挑出状态列，其余列与本断言无关。 */ (column) =>
        column.field === 'status',
    );

    expect(status).toMatchObject({
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_JOB_STATUS },
      },
      minWidth: 100,
      title: '任务状态',
    });
  });

  it('首列是复选框且操作列固定在最右', /** 缺少复选框列会让用户无法批量操作，操作列不固定会随横向滚动消失。 */ () => {
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
});

describe('任务详情描述项', /** 描述项决定详情页展示的字段与格式化结果。 */ () => {
  it('按约定顺序声明详情字段', /** 漏字段会让管理员看不到任务的关键配置。 */ () => {
    expect(
      useDetailSchema().map(
        /** 取出描述项字段名用于核对顺序。 */ (item) => item.field,
      ),
    ).toEqual([
      'id',
      'name',
      'status',
      'handlerName',
      'handlerParam',
      'cronExpression',
      'retryCount',
      'retryInterval',
      'monitorTimeout',
      'nextTimes',
    ]);
  });

  it('任务状态渲染为字典标签', /** 状态直接输出原始字典值会让管理员读不懂运行状态。 */ () => {
    const node = renderDetail(findDetailItem('status'), 1);

    expect(node).toMatchObject({
      props: { type: DICT_TYPE.INFRA_JOB_STATUS, value: 1 },
      type: stubs.dictTag,
    });
  });

  it('重试间隔为 0 或缺失时显示无间隔', /** 直接输出裸数字会让管理员误以为存在重试间隔。 */ () => {
    const item = findDetailItem('retryInterval');

    expect(renderDetail(item, 5000)).toBe('5000 毫秒');
    expect(renderDetail(item, 0)).toBe('无间隔');
    expect(renderDetail(item, undefined)).toBe('无间隔');
  });

  it('监控超时未开启时显示未开启', /** 把 0 或负数当成已开启会让管理员误判任务有超时保护。 */ () => {
    const item = findDetailItem('monitorTimeout');

    expect(renderDetail(item, 1000)).toBe('1000 毫秒');
    expect(renderDetail(item, 0)).toBe('未开启');
    expect(renderDetail(item, -1)).toBe('未开启');
  });

  it('后续执行时间缺失时给出明确文案', /** 空白会让管理员以为任务没有下次执行。 */ () => {
    const item = findDetailItem('nextTimes');

    expect(renderDetail(item, [])).toBe('无后续执行时间');
    expect(renderDetail(item, undefined)).toBe('无后续执行时间');
  });

  it('后续执行时间按时间线逐条渲染并格式化', /** 未格式化会让管理员看到时间戳，漏渲染会让条目数量不符。 */ () => {
    const node = renderDetail(findDetailItem('nextTimes'), NEXT_TIMES);
    const host = mount(
      defineComponent({
        name: 'TimelineHost',
        /** 渲染详情项返回的时间线节点。 */
        render: () => node,
      }),
    );

    expect(host.findAll('.el-timeline-item')).toHaveLength(NEXT_TIMES.length);
    expect(host.text()).toContain('2024-03-04');
    expect(host.text()).toContain('2024-03-05');
  });
});

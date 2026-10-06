/**
 * 定时任务模块的字段定义：新增编辑表单、搜索条件、列表列与详情项。
 *
 * 已有任务的处理器名锁定不可改，重试次数与间隔、超时时间以毫秒为单位；
 * 只声明字段与渲染函数，启停、执行一次等动作由页面调用接口完成。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { DescriptionItemSchema } from '#/components/description';

import { h, markRaw } from 'vue';

import { DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';
import { formatDateTime } from '@vben/utils';

import { ElTimeline, ElTimelineItem } from 'element-plus';

import { CronTab } from '#/components/cron-tab';
import { DictTag } from '#/components/dict-tag';

/** 新增/修改的表单 */
/**
 * 构造定时任务的新增与编辑表单 schema。
 * @returns 任务表单的字段定义数组。
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'id',
      component: 'Input',
      dependencies: {
        triggerFields: [''],
        /** 任务主键只在编辑时回显，不作为可填字段展示，避免提交时指向别的任务。 */
        show: () => false,
      },
    },
    {
      fieldName: 'name',
      label: '任务名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入任务名称',
      },
      rules: 'required',
    },
    {
      fieldName: 'handlerName',
      label: '处理器的名字',
      component: 'Input',
      componentProps: {
        placeholder: '请输入处理器的名字',
      },
      dependencies: {
        triggerFields: ['id'],
        /**
         * 已存在的任务锁定处理器名：它决定调度时调用的 Bean，改名会让任务在下次触发时无法执行。
         */
        disabled: (values) => !!values.id,
      },
      rules: 'required',
    },
    {
      fieldName: 'handlerParam',
      label: '处理器的参数',
      component: 'Input',
      componentProps: {
        placeholder: '请输入处理器的参数',
      },
    },
    {
      fieldName: 'cronExpression',
      label: 'CRON 表达式',
      component: markRaw(CronTab),
      componentProps: {
        placeholder: '请输入 CRON 表达式',
      },
      rules: 'required',
    },
    {
      fieldName: 'retryCount',
      label: '重试次数',
      component: 'InputNumber',
      componentProps: {
        placeholder: '请输入重试次数。设置为 0 时，不进行重试',
        min: 0,
        controlsPosition: 'right',
        class: '!w-full',
      },
      rules: 'required',
    },
    {
      fieldName: 'retryInterval',
      label: '重试间隔',
      component: 'InputNumber',
      componentProps: {
        placeholder: '请输入重试间隔，单位：毫秒。设置为 0 时，无需间隔',
        min: 0,
        controlsPosition: 'right',
        class: '!w-full',
      },
      rules: 'required',
    },
    {
      fieldName: 'monitorTimeout',
      label: '监控超时时间',
      component: 'InputNumber',
      componentProps: {
        placeholder: '请输入监控超时时间，单位：毫秒',
        min: 0,
        controlsPosition: 'right',
        class: '!w-full',
      },
    },
  ];
}

/**
 * 列表的搜索表单
 * @returns 搜索字段：任务名称与处理器名字按输入内容模糊匹配，任务状态为字典下拉。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '任务名称',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入任务名称',
      },
    },
    {
      fieldName: 'status',
      label: '任务状态',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.INFRA_JOB_STATUS, 'number'),
        clearable: true,
        placeholder: '请选择任务状态',
      },
    },
    {
      fieldName: 'handlerName',
      label: '处理器的名字',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入处理器的名字',
      },
    },
  ];
}

/**
 * 表格列配置
 * @returns 列定义：任务状态按字典渲染为标签，操作列固定在右侧由页面插槽渲染。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '任务编号',
      minWidth: 80,
    },
    {
      field: 'name',
      title: '任务名称',
      minWidth: 120,
    },
    {
      field: 'status',
      title: '任务状态',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_JOB_STATUS },
      },
    },
    {
      field: 'handlerName',
      title: '处理器的名字',
      minWidth: 180,
    },
    {
      field: 'handlerParam',
      title: '处理器的参数',
      minWidth: 140,
    },
    {
      field: 'cronExpression',
      title: 'CRON 表达式',
      minWidth: 120,
    },
    {
      title: '操作',
      width: 240,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

/** 详情页的字段 */
/**
 * 构造定时任务详情的描述项。
 * @returns 详情页的描述项定义数组。
 */
export function useDetailSchema(): DescriptionItemSchema[] {
  return [
    {
      field: 'id',
      label: '任务编号',
    },
    {
      field: 'name',
      label: '任务名称',
    },
    {
      field: 'status',
      label: '任务状态',
      /**
       * 任务状态是字典值，运行中与已停止需要用颜色区分。
       * @param val 当前单元格的字典值。
       * @returns 字典标签节点。
       */
      render: (val) => {
        return h(DictTag, {
          type: DICT_TYPE.INFRA_JOB_STATUS,
          value: val as boolean | number | string,
        });
      },
    },
    {
      field: 'handlerName',
      label: '处理器的名字',
    },
    {
      field: 'handlerParam',
      label: '处理器的参数',
    },
    {
      field: 'cronExpression',
      label: 'Cron 表达式',
    },
    {
      field: 'retryCount',
      label: '重试次数',
    },
    {
      label: '重试间隔',
      field: 'retryInterval',
      /**
       * 重试间隔以毫秒为单位，便于与监控超时时间对照；未配置时展示为无间隔。
       * @param val 当前字段值，只有数字才被视为有效的毫秒数。
       * @returns 带毫秒单位的文本，值无效或为 0 时返回无间隔。
       */
      render: (val) => {
        const value = typeof val === 'number' ? val : undefined;
        return value ? `${value} 毫秒` : '无间隔';
      },
    },
    {
      label: '监控超时时间',
      field: 'monitorTimeout',
      /**
       * 监控超时时间以毫秒为单位；为 0 或未配置说明该任务没有开启超时监控。
       * @param val 当前字段值，只有数字才被视为有效的毫秒数。
       * @returns 带毫秒单位的文本，值无效或不大于 0 时返回未开启。
       */
      render: (val) => {
        const value = typeof val === 'number' ? val : undefined;
        return value && value > 0 ? `${value} 毫秒` : '未开启';
      },
    },
    {
      field: 'nextTimes',
      label: '后续执行时间',
      /**
       * 把后端推算出的后续执行时间按时间轴逐条展示，便于预判调度节奏与是否已停用。
       * @param val 当前字段值，期望为日期数组；非数组按空数组处理。
       * @returns 时间轴节点；没有后续执行时间时返回提示文本。
       */
      render: (val) => {
        const times: Date[] = Array.isArray(val) ? (val as Date[]) : [];
        if (times.length === 0) {
          return '无后续执行时间';
        }
        return h(ElTimeline, {}, () =>
          times.map((time: Date) =>
            h(ElTimelineItem, {}, () => formatDateTime(time)),
          ),
        );
      },
    },
  ];
}

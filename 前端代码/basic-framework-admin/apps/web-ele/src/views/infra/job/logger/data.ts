/**
 * 定时任务执行日志的检索条件、表格列与详情字段定义。
 * 由日志列表页和日志详情弹窗共用，只描述展示结构；
 * 日志的采集、重试与落库都在后端调度侧，这里不发起请求。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { DescriptionItemSchema } from '#/components/description';

import { h } from 'vue';

import { DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';
import { formatDateTime, toFormatDateValue } from '@vben/utils';

import dayjs from 'dayjs';

import { DictTag } from '#/components/dict-tag';

/**
 * 日志详情渲染时要用的结束时间。
 * 描述项的渲染函数会收到整行数据，而列表行类型未声明该字段，这里只收窄实际用到的字段。
 */
type JobLogDetail = {
  endTime?: Date | string;
};

/**
 * 列表的搜索表单
 * @returns 搜索字段：处理器名字按输入内容模糊匹配，任务状态为字典下拉，
 * 开始与结束时间各自为带时分的单点选择，提交时按 YYYY-MM-DD HH:mm:ss 传给后端。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'handlerName',
      label: '处理器的名字',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入处理器的名字',
      },
    },
    {
      fieldName: 'beginTime',
      label: '开始执行时间',
      component: 'DatePicker',
      componentProps: {
        clearable: true,
        placeholder: '选择开始执行时间',
        valueFormat: 'YYYY-MM-DD HH:mm:ss',
        showTime: {
          format: 'HH:mm:ss',
          defaultValue: dayjs('00:00:00', 'HH:mm:ss'),
        },
        class: '!w-full',
      },
    },
    {
      fieldName: 'endTime',
      label: '结束执行时间',
      component: 'DatePicker',
      componentProps: {
        clearable: true,
        placeholder: '选择结束执行时间',
        valueFormat: 'YYYY-MM-DD HH:mm:ss',
        showTime: {
          format: 'HH:mm:ss',
          defaultValue: dayjs('23:59:59', 'HH:mm:ss'),
        },
      },
    },
    {
      fieldName: 'status',
      label: '任务状态',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.INFRA_JOB_LOG_STATUS, 'number'),
        clearable: true,
        placeholder: '请选择任务状态',
      },
    },
  ];
}

/**
 * 表格列配置
 * @returns 定时任务日志表格的列定义，含时间格式化与状态字典渲染。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    {
      field: 'id',
      title: '日志编号',
      minWidth: 80,
    },
    {
      field: 'jobId',
      title: '任务编号',
      minWidth: 80,
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
      field: 'executeIndex',
      title: '第几次执行',
      minWidth: 100,
    },
    {
      field: 'beginTime',
      title: '执行时间',
      minWidth: 280,
      /**
       * 渲染执行时间区间；任一端非法时按空串输出，区间仍以「 ~ 」分隔保持列宽稳定。
       * @param params vxe-table 的单元格上下文。
       * @param params.row 当前行的原始数据，执行时间字段按日期类型收窄后再格式化。
       * @returns 格式化后的时间区间文本。
       */
      formatter: ({ row }) => {
        // 行字段是 unknown，按日期类型收窄后再格式化，非法值输出空串
        const beginTime = formatDateTime(toFormatDateValue(row.beginTime));
        const endTime = formatDateTime(toFormatDateValue(row.endTime));
        return `${beginTime} ~ ${endTime}`;
      },
    },
    {
      field: 'duration',
      title: '执行时长',
      minWidth: 120,
      /**
       * 执行时长由后端以毫秒返回，这里补上单位后直接展示，不做单位换算。
       */
      formatter: ({ row }) => {
        return `${row.duration} 毫秒`;
      },
    },
    {
      field: 'status',
      title: '任务状态',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_JOB_LOG_STATUS },
      },
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

/** 详情页的字段 */
/**
 * 构造任务日志详情的描述项。
 * @returns 日志详情页的描述项定义数组。
 */
export function useDetailSchema(): DescriptionItemSchema[] {
  return [
    {
      field: 'id',
      label: '日志编号',
    },
    {
      field: 'jobId',
      label: '任务编号',
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
      field: 'executeIndex',
      label: '第几次执行',
    },
    {
      field: 'beginTime',
      label: '执行时间',
      /**
       * 详情中的执行时间是开始与结束组成的区间，结束时间需要从整行数据里取；
       * 任一端缺失时返回空串，不展示半截区间。
       */
      render: (val, data) => {
        const detail = data as JobLogDetail | undefined;
        if (val && detail?.endTime) {
          return `${formatDateTime(val as Date | string)} ~ ${formatDateTime(detail.endTime)}`;
        }
        return '';
      },
    },
    {
      field: 'duration',
      label: '执行时长',
      /**
       * 执行时长以毫秒为单位展示；后端未给出数值时留空，避免把非法值当成 0 毫秒误导读者。
       * @param val 当前字段值，只有数字才被视为有效的毫秒数。
       * @returns 带毫秒单位的文本，值无效或为 0 时返回空串。
       */
      render: (val) => {
        const value = typeof val === 'number' ? val : undefined;
        return value ? `${value} 毫秒` : '';
      },
    },
    {
      field: 'status',
      label: '任务状态',
      /**
       * 日志记录的是执行那一刻的状态快照，字典值渲染成标签便于和任务列表对照。
       * @param val 当前单元格的字典值。
       * @returns 字典标签节点。
       */
      render: (val) => {
        return h(DictTag, {
          type: DICT_TYPE.INFRA_JOB_LOG_STATUS,
          value: val as boolean | number | string,
        });
      },
    },
    {
      field: 'result',
      label: '执行结果',
    },
  ];
}

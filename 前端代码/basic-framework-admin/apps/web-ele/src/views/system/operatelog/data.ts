/**
 * 操作日志的检索项、表格列与详情字段定义，列表页和详情弹窗共用。
 * 详情比列表多出链路追踪、请求地址等字段，按行数据决定是否展示；
 * 日志由后端切面记录，本模块只读展示。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { DescriptionItemSchema } from '#/components/description';

import { h } from 'vue';

import { DICT_TYPE } from '@vben/constants';
import { formatDateTime } from '@vben/utils';

import { getSimpleUserList } from '#/api/system/user';
import { DictTag } from '#/components/dict-tag';
import { getRangePickerDefaultProps } from '#/utils';

/** 详情渲染时用到的日志附加字段：请求方法用于与请求地址拼成一行，其余字段按后端返回可选。 */
type OperateLogDetail = {
  requestMethod?: string;
  traceId?: string;
};

/**
 * 操作日志列表的检索条件：操作人从用户列表中选择，模块、操作名与操作内容模糊匹配。
 * @returns 表单 schema 列表；各项均非必填，清空即表示不按该条件过滤。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'userId',
      label: '操作人',
      component: 'ApiSelect',
      componentProps: {
        api: getSimpleUserList,
        labelField: 'nickname',
        valueField: 'id',
        clearable: true,
        placeholder: '请选择操作人员',
      },
    },
    {
      fieldName: 'type',
      label: '操作模块',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入操作模块',
      },
    },
    {
      fieldName: 'subType',
      label: '操作名',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入操作名',
      },
    },
    {
      fieldName: 'action',
      label: '操作内容',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入操作内容',
      },
    },
    {
      fieldName: 'createTime',
      label: '操作时间',
      component: 'RangePicker',
      componentProps: {
        ...getRangePickerDefaultProps(),
        clearable: true,
      },
    },
    {
      fieldName: 'bizId',
      label: '业务编号',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入业务编号',
      },
    },
  ];
}

/**
 * 操作日志列表的列定义：编号、操作人、模块、操作名、内容、时间、业务编号与操作 IP。
 * @returns 列定义数组；操作时间用 formatDateTime 格式化，操作列由父级插槽提供。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    {
      field: 'id',
      title: '日志编号',
      minWidth: 100,
    },
    {
      field: 'userName',
      title: '操作人',
      minWidth: 120,
    },
    {
      field: 'type',
      title: '操作模块',
      minWidth: 120,
    },
    {
      field: 'subType',
      title: '操作名',
      minWidth: 160,
    },
    {
      field: 'action',
      title: '操作内容',
      minWidth: 200,
    },
    {
      field: 'createTime',
      title: '操作时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      field: 'bizId',
      title: '业务编号',
      minWidth: 120,
    },
    {
      field: 'userIp',
      title: '操作 IP',
      minWidth: 120,
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
 * 构造操作日志详情的描述项。
 * @returns 操作日志详情页的描述项定义数组。
 */
export function useDetailSchema(): DescriptionItemSchema[] {
  return [
    {
      field: 'id',
      label: '日志编号',
    },
    {
      field: 'traceId',
      label: '链路追踪',
      /**
       * 列表页没有链路号，只有详情数据里才有，因此按行数据决定是否显示该列。
       * @param args vxe-table 传入的显示回调参数，首个参数是当前行数据。
       * @returns 隐藏该列时返回 true。
       */
      show: (...args) => !(args[0] as OperateLogDetail | undefined)?.traceId,
    },
    {
      field: 'userId',
      label: '操作人编号',
    },
    {
      field: 'userType',
      label: '操作人类型',
      /**
       * 操作人类型是字典值，渲染成标签便于区分用户与自动化任务。
       * @param val 当前单元格的字典值。
       * @returns 字典标签节点。
       */
      render: (val) =>
        h(DictTag, {
          type: DICT_TYPE.USER_TYPE,
          value: val as boolean | number | string,
        }),
    },
    {
      field: 'userName',
      label: '操作人名字',
    },
    {
      field: 'userIp',
      label: '操作人 IP',
    },
    {
      field: 'userAgent',
      label: '操作人 UA',
    },
    {
      field: 'type',
      label: '操作模块',
    },
    {
      field: 'subType',
      label: '操作名',
    },
    {
      field: 'action',
      label: '操作内容',
    },
    {
      field: 'extra',
      label: '操作拓展参数',
      /** 该项是否渲染：show 收到整条记录，这里只在记录为空时保留，正常有数据时不展示。 */
      show: (val) => !val,
    },
    {
      field: 'requestUrl',
      label: '请求 URL',
      /** 把请求方法与请求地址拼成一行展示；缺少请求方法或取值不是字符串时返回空串。 */
      render: (val, data) => {
        const detail = data as OperateLogDetail | undefined;
        if (detail?.requestMethod && typeof val === 'string') {
          return `${detail.requestMethod} ${val}`;
        }
        return '';
      },
    },
    {
      field: 'createTime',
      label: '操作时间',
      /**
       * 操作时间按统一的日期时间格式展示，空值交给格式化函数兜底为空串。
       * @param val 原始时间值，可能是 Date、字符串或空值。
       * @returns 格式化后的日期时间文本。
       */
      render: (val) =>
        formatDateTime(val as Date | string | undefined) as string,
    },
    {
      field: 'bizId',
      label: '业务编号',
    },
  ];
}

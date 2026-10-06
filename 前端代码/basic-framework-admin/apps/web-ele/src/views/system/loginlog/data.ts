/**
 * 登录日志的检索项、表格列与详情字段定义，列表页和详情弹窗共用。
 * 登录时间与登录结果在此转成文本和字典标签；
 * 日志由后端登录流程写入，本模块只读展示。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { DescriptionItemSchema } from '#/components/description';

import { h } from 'vue';

import { DICT_TYPE } from '@vben/constants';
import { formatDateTime } from '@vben/utils';

import { DictTag } from '#/components/dict-tag';
import { getRangePickerDefaultProps } from '#/utils';

/**
 * 登录日志列表的检索条件：用户名称与登录地址模糊匹配，登录时间按区间筛选。
 * @returns 表单 schema 列表；三项均非必填，清空即表示不按该条件过滤。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'username',
      label: '用户名称',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入用户名称',
      },
    },
    {
      fieldName: 'userIp',
      label: '登录地址',
      component: 'Input',
      componentProps: {
        clearable: true,
        placeholder: '请输入登录地址',
      },
    },
    {
      fieldName: 'createTime',
      label: '登录时间',
      component: 'RangePicker',
      componentProps: {
        ...getRangePickerDefaultProps(),
        clearable: true,
      },
    },
  ];
}

/**
 * 登录日志列表的列定义：编号、登录类型、用户、地址、浏览器、结果与登录日期。
 * @returns 列定义数组；登录类型与结果用 CellDict 渲染，操作列由父级插槽提供。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    {
      field: 'id',
      title: '日志编号',
      minWidth: 100,
    },
    {
      field: 'logType',
      title: '登录类型',
      minWidth: 120,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_LOGIN_TYPE },
      },
    },
    {
      field: 'username',
      title: '用户名称',
      minWidth: 180,
    },
    {
      field: 'userIp',
      title: '登录地址',
      minWidth: 180,
    },
    {
      field: 'userAgent',
      title: '浏览器',
      minWidth: 200,
    },
    {
      field: 'result',
      title: '登录结果',
      minWidth: 120,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_LOGIN_RESULT },
      },
    },
    {
      field: 'createTime',
      title: '登录日期',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

/** 详情页的字段 */
/**
 * 构造登录日志详情的描述项。
 * @returns 登录日志详情页的描述项定义数组。
 */
export function useDetailSchema(): DescriptionItemSchema[] {
  return [
    {
      field: 'id',
      label: '日志编号',
    },
    {
      field: 'logType',
      label: '登录类型',
      /**
       * 登录类型是字典值，交给 DictTag 渲染成带底色的标签而不是裸数字。
       * @param val 当前单元格的字典值。
       * @returns 字典标签节点。
       */
      render: (val) => {
        return h(DictTag, {
          type: DICT_TYPE.SYSTEM_LOGIN_TYPE,
          value: val as boolean | number | string,
        });
      },
    },
    {
      field: 'username',
      label: '用户名称',
    },
    {
      field: 'userIp',
      label: '登录地址',
    },
    {
      field: 'userAgent',
      label: '浏览器',
    },
    {
      field: 'result',
      label: '登录结果',
      /**
       * 登录结果同样是字典值，成功与失败需要用颜色区分。
       * @param val 当前单元格的字典值。
       * @returns 字典标签节点。
       */
      render: (val) => {
        return h(DictTag, {
          type: DICT_TYPE.SYSTEM_LOGIN_RESULT,
          value: val as boolean | number | string,
        });
      },
    },
    {
      field: 'createTime',
      label: '登录日期',
      /**
       * 登录时间按统一的日期时间格式展示，空值交给格式化函数兜底为空串。
       * @param val 原始时间值，可能是 Date、字符串或空值。
       * @returns 格式化后的日期时间文本。
       */
      render: (val) =>
        formatDateTime(val as Date | string | undefined) as string,
    },
  ];
}

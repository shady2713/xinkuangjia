/**
 * 岗位管理页的表单、检索与列表字段定义，新增与修改共用一套表单。
 * 主键字段对表单隐藏，页面只提交名称、编码、顺序、状态与备注；
 * 增删改查请求由列表页和表单弹窗发起。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { z } from '#/adapter/form';

/**
 * 岗位新增/修改弹窗的表单字段：名称、编码与显示顺序必填，状态默认启用。
 * @returns 表单 schema 列表；id 为隐藏字段，仅用于区分新增与编辑。
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'id',
      dependencies: {
        triggerFields: [''],
        /** id 只随记录带回，不在表单上展示，避免用户手工覆盖主键。 */
        show: () => false,
      },
    },
    {
      component: 'Input',
      fieldName: 'name',
      label: '岗位名称',
      componentProps: {
        placeholder: '请输入岗位名称',
      },
      rules: 'required',
    },
    {
      component: 'Input',
      fieldName: 'code',
      label: '岗位编码',
      componentProps: {
        placeholder: '请输入岗位编码',
      },
      rules: 'required',
    },
    {
      fieldName: 'sort',
      label: '显示顺序',
      component: 'InputNumber',
      componentProps: {
        min: 0,
        placeholder: '请输入显示顺序',
        controlsPosition: 'right',
        class: '!w-full',
      },
      rules: 'required',
    },
    {
      fieldName: 'status',
      label: '岗位状态',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      },
      rules: z.number().default(CommonStatusEnum.ENABLE),
    },
    {
      fieldName: 'remark',
      label: '岗位备注',
      component: 'Textarea',
      componentProps: {
        placeholder: '请输入岗位备注',
      },
    },
  ];
}

/**
 * 岗位列表的检索条件：名称与编码模糊匹配，状态精确匹配。
 * @returns 表单 schema 列表；三项均非必填，清空即表示不按该条件过滤。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '岗位名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入岗位名称',
        clearable: true,
      },
    },
    {
      fieldName: 'code',
      label: '岗位编码',
      component: 'Input',
      componentProps: {
        placeholder: '请输入岗位编码',
        clearable: true,
      },
    },
    {
      fieldName: 'status',
      label: '岗位状态',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
        placeholder: '请选择岗位状态',
        clearable: true,
      },
    },
  ];
}

/**
 * 岗位列表的列定义：编号、名称、编码、显示顺序、备注与状态。
 * @returns 列定义数组；首列为多选列，状态列用 CellDict 渲染，操作列由父级插槽提供。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '岗位编号',
      minWidth: 200,
    },
    {
      field: 'name',
      title: '岗位名称',
      minWidth: 200,
    },
    {
      field: 'code',
      title: '岗位编码',
      minWidth: 200,
    },
    {
      field: 'sort',
      title: '显示顺序',
      minWidth: 100,
    },
    {
      field: 'remark',
      title: '岗位备注',
      minWidth: 200,
    },
    {
      field: 'status',
      title: '岗位状态',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
    },
    {
      field: 'createTime',
      title: '创建时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

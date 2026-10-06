/**
 * 字典管理页左右两栏的字段定义：类型栏与数据栏的表单、检索与列。
 * 数据栏的颜色选项只服务字典标签着色，两栏弹窗的提交请求不在此模块。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { z } from '#/adapter/form';
import { getSimpleDictTypeList } from '#/api/system/dict/type';

// ============================== 字典类型 ==============================

/**
 * 字典类型新增/修改弹窗的表单字段：名称与类型必填，类型在已有记录时锁定不可改。
 * @returns 表单 schema 列表；id 为隐藏字段，仅用于区分新增与编辑。
 */
export function useTypeFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'id',
      component: 'Input',
      dependencies: {
        triggerFields: [''],
        /** id 只随记录带回，不在表单上展示，避免用户手工覆盖主键。 */
        show: () => false,
      },
    },
    {
      fieldName: 'name',
      label: '字典名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入字典名称',
      },
      rules: 'required',
    },
    {
      fieldName: 'type',
      label: '字典类型',
      component: 'Input',
      /** 字典类型建好后不再允许改动，这里按是否已带 id 决定该字段是否可编辑。 */
      componentProps: (values) => {
        return {
          placeholder: '请输入字典类型',
          disabled: !!values.id,
        };
      },
      rules: 'required',
      dependencies: {
        triggerFields: [''],
      },
    },
    {
      fieldName: 'status',
      label: '状态',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      },
      rules: z.number().default(CommonStatusEnum.ENABLE),
    },
    {
      fieldName: 'remark',
      label: '备注',
      component: 'Textarea',
      componentProps: {
        placeholder: '请输入备注',
      },
    },
  ];
}

/**
 * 字典类型列表的检索条件：名称与类型按输入值模糊匹配，状态精确匹配。
 * @returns 表单 schema 列表；三项均非必填，清空即表示不按该条件过滤。
 */
export function useTypeGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '字典名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入字典名称',
        clearable: true,
      },
    },
    {
      fieldName: 'type',
      label: '字典类型',
      component: 'Input',
      componentProps: {
        placeholder: '请输入字典类型',
        clearable: true,
      },
    },
    {
      fieldName: 'status',
      label: '状态',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
        placeholder: '请选择状态',
        clearable: true,
      },
    },
  ];
}

/**
 * 字典类型列表的列定义：编号、名称、类型、状态与创建时间。
 * @returns 列定义数组；首列为多选列，状态列用 CellDict 渲染成字典标签。
 */
export function useTypeGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '字典编号',
      minWidth: 100,
    },
    {
      field: 'name',
      title: '字典名称',
      minWidth: 200,
    },
    {
      field: 'type',
      title: '字典类型',
      minWidth: 220,
    },
    {
      field: 'status',
      title: '状态',
      minWidth: 120,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
    },
    {
      field: 'remark',
      title: '备注',
      minWidth: 180,
    },
    {
      field: 'createTime',
      title: '创建时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      minWidth: 120,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

// ============================== 字典数据 ==============================

// 当前颜色选项仅用于 web-ele 字典页。
/** 颜色选项 */
const colorOptions = [
  { value: '', label: '无' },
  { value: 'processing', label: '主要' },
  { value: 'success', label: '成功' },
  { value: 'default', label: '默认' },
  { value: 'warning', label: '警告' },
  { value: 'error', label: '危险' },
  { value: 'pink', label: 'pink' },
  { value: 'red', label: 'red' },
  { value: 'orange', label: 'orange' },
  { value: 'green', label: 'green' },
  { value: 'cyan', label: 'cyan' },
  { value: 'blue', label: 'blue' },
  { value: 'purple', label: 'purple' },
];

/**
 * 字典数据新增/修改弹窗的表单字段：所属字典类型、标签、键值、排序必填，
 * 颜色类型与 CSS Class 只影响标签展示样式。
 * @returns 表单 schema 列表；id 为隐藏字段，字典类型在已有记录时锁定不可改。
 */
export function useDataFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'id',
      component: 'Input',
      dependencies: {
        triggerFields: [''],
        /** id 只随记录带回，不在表单上展示，避免用户手工覆盖主键。 */
        show: () => false,
      },
    },
    {
      fieldName: 'dictType',
      label: '字典类型',
      component: 'ApiSelect',
      /** 字典数据必须归属一个已存在的字典类型，建好后不再允许改挂，这里按是否已带 id 锁定。 */
      componentProps: (values) => {
        return {
          api: getSimpleDictTypeList,
          placeholder: '请输入字典类型',
          labelField: 'name',
          valueField: 'type',
          disabled: !!values.id,
        };
      },
      rules: 'required',
      dependencies: {
        triggerFields: [''],
      },
    },
    {
      fieldName: 'label',
      label: '数据标签',
      component: 'Input',
      componentProps: {
        placeholder: '请输入数据标签',
      },
      rules: 'required',
    },
    {
      fieldName: 'value',
      label: '数据键值',
      component: 'Input',
      componentProps: {
        placeholder: '请输入数据键值',
      },
      rules: 'required',
    },
    {
      fieldName: 'sort',
      label: '显示排序',
      component: 'InputNumber',
      componentProps: {
        placeholder: '请输入显示排序',
        controlsPosition: 'right',
        class: '!w-full',
      },
      rules: 'required',
    },
    {
      fieldName: 'status',
      label: '状态',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
        placeholder: '请选择状态',
      },
      rules: z.number().default(CommonStatusEnum.ENABLE),
    },
    {
      fieldName: 'colorType',
      label: '颜色类型',
      component: 'Select',
      componentProps: {
        options: colorOptions,
        placeholder: '请选择颜色类型',
      },
    },
    {
      fieldName: 'cssClass',
      label: 'CSS Class',
      component: 'Input',
      componentProps: {
        placeholder: '请输入 CSS Class',
      },
      help: '输入 hex 模式的颜色, 例如 #108ee9',
    },
    {
      fieldName: 'remark',
      label: '备注',
      component: 'Textarea',
      componentProps: {
        placeholder: '请输入备注',
      },
    },
  ];
}

/**
 * 字典数据列表的检索条件：标签按输入值模糊匹配，状态精确匹配。
 * @returns 表单 schema 列表；两项均非必填，清空即表示不按该条件过滤。
 */
export function useDataGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'label',
      label: '字典标签',
      component: 'Input',
      componentProps: {
        placeholder: '请输入字典标签',
        clearable: true,
      },
    },
    {
      fieldName: 'status',
      label: '状态',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
        placeholder: '请选择状态',
        clearable: true,
      },
    },
  ];
}

/**
 * 字典数据列表的列定义：编码、标签、键值、排序、状态、颜色与创建时间。
 * @returns 列定义数组；首列为多选列，状态列用 CellDict 渲染，操作列由父级插槽提供。
 */
export function useDataGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '字典编码',
      minWidth: 100,
    },
    {
      field: 'label',
      title: '字典标签',
      minWidth: 180,
    },
    {
      field: 'value',
      title: '字典键值',
      minWidth: 100,
    },
    {
      field: 'sort',
      title: '字典排序',
      minWidth: 100,
    },
    {
      field: 'status',
      title: '状态',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
    },
    {
      field: 'colorType',
      title: '颜色类型',
      minWidth: 120,
    },
    {
      field: 'cssClass',
      title: 'CSS Class',
      minWidth: 120,
    },
    {
      title: '创建时间',
      field: 'createTime',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      minWidth: 120,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

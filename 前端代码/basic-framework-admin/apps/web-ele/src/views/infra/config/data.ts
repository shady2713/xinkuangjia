/**
 * 参数配置模块的字段定义：新增编辑表单、搜索条件与列表列。
 *
 * 键名、键值、分类为必填，是否可见取布尔字典，时间列走统一格式化；
 * 只声明字段定义，请求与弹窗装配由同目录页面负责。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { z } from '@vben/common-ui';
import { DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { getRangePickerDefaultProps } from '#/utils';

/** 新增/修改的表单 */
/**
 * 构造参数配置的表单 schema。
 * @returns 配置表单的字段定义数组。
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'id',
      dependencies: {
        triggerFields: [''],
        /** 参数主键只在编辑时回显，不作为可填字段展示，避免被误改后指向别的配置项。 */
        show: () => false,
      },
    },
    {
      fieldName: 'category',
      label: '参数分类',
      component: 'Input',
      componentProps: {
        placeholder: '请输入参数分类',
      },
      rules: z
        .string()
        .min(1, '请输入参数分类')
        .max(50, '参数分类不能超过50个字符'),
    },
    {
      fieldName: 'name',
      label: '参数名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入参数名称',
      },
      rules: 'required',
    },
    {
      fieldName: 'key',
      label: '参数键名',
      component: 'Input',
      componentProps: {
        placeholder: '请输入参数键名',
      },
      rules: 'required',
    },
    {
      fieldName: 'value',
      label: '参数键值',
      component: 'Input',
      componentProps: {
        placeholder: '请输入参数键值',
      },
      rules: 'required',
    },
    {
      fieldName: 'visible',
      label: '是否可见',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.INFRA_BOOLEAN_STRING, 'boolean'),
      },
      defaultValue: true,
      rules: 'required',
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
 * 列表的搜索表单
 * @returns 搜索字段：参数名称与参数键名按输入内容模糊匹配，系统内置为下拉，创建时间为区间选择。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '参数名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入参数名称',
        clearable: true,
      },
    },
    {
      fieldName: 'key',
      label: '参数键名',
      component: 'Input',
      componentProps: {
        placeholder: '请输入参数键名',
        clearable: true,
      },
    },
    {
      fieldName: 'type',
      label: '系统内置',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.INFRA_CONFIG_TYPE, 'number'),
        placeholder: '请选择系统内置',
        clearable: true,
      },
    },
    {
      fieldName: 'createTime',
      label: '创建时间',
      component: 'RangePicker',
      componentProps: {
        ...getRangePickerDefaultProps(),
        clearable: true,
      },
    },
  ];
}

/**
 * 列表的字段
 * @returns 列定义：是否可见与系统内置按字典翻译，创建时间统一格式化，操作列固定在右侧由插槽渲染。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '参数主键',
      minWidth: 100,
    },
    {
      field: 'category',
      title: '参数分类',
      minWidth: 120,
    },
    {
      field: 'name',
      title: '参数名称',
      minWidth: 200,
    },
    {
      field: 'key',
      title: '参数键名',
      minWidth: 200,
    },
    {
      field: 'value',
      title: '参数键值',
      minWidth: 150,
    },
    {
      field: 'visible',
      title: '是否可见',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_BOOLEAN_STRING },
      },
    },
    {
      field: 'type',
      title: '系统内置',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.INFRA_CONFIG_TYPE },
      },
    },
    {
      field: 'remark',
      title: '备注',
      minWidth: 150,
    },
    {
      field: 'createTime',
      title: '创建时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

/**
 * 短信模板的表单、检索与列表字段定义。
 * 模板归属渠道、模板内容与 API 模板编号在此声明；
 * 模板的发送与渠道校验由后端完成，页面不做内容解析。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { z } from '#/adapter/form';

/**
 * 短信模板新增/修改弹窗的表单字段：模板编号、名称、类型、内容与所属渠道。
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
      component: 'Select',
      fieldName: 'type',
      label: '短信类型',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_SMS_TEMPLATE_TYPE, 'number'),
        placeholder: '请选择短信类型',
      },
      rules: 'required',
    },
    {
      component: 'Select',
      fieldName: 'status',
      label: '开启状态',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      },
      rules: z.number().default(CommonStatusEnum.ENABLE),
    },
    {
      component: 'Input',
      fieldName: 'code',
      label: '模板编号',
      componentProps: {
        placeholder: '请输入模板编号',
      },
      rules: 'required',
    },
    {
      component: 'Input',
      fieldName: 'name',
      label: '模板名称',
      componentProps: {
        placeholder: '请输入模板名称',
      },
      rules: 'required',
    },
    {
      component: 'Input',
      fieldName: 'apiTemplateId',
      label: 'API 模板编号',
      componentProps: {
        placeholder: '请输入 API 模板编号',
      },
      rules: 'required',
    },
    {
      component: 'Input',
      fieldName: 'channelId',
      label: '短信渠道',
      componentProps: {
        placeholder: '请输入短信渠道编号',
      },
      rules: 'required',
    },
    {
      component: 'Textarea',
      fieldName: 'content',
      label: '模板内容',
      componentProps: {
        placeholder: '请输入模板内容',
      },
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
 * 短信模板列表的检索条件：模板编号模糊匹配，短信类型与状态精确匹配。
 * @returns 表单 schema 列表；三项均非必填，清空即表示不按该条件过滤。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'code',
      label: '模板编号',
      component: 'Input',
      componentProps: {
        placeholder: '请输入模板编号',
        clearable: true,
      },
    },
    {
      fieldName: 'type',
      label: '短信类型',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_SMS_TEMPLATE_TYPE, 'number'),
        placeholder: '请选择短信类型',
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
 * 短信模板列表的列定义：编号、模板编号、名称、类型、状态、内容、API 模板编号与渠道。
 * @returns 列定义数组；首列为多选列，类型与状态用 CellDict 渲染，操作列由父级插槽提供。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '编号',
      minWidth: 100,
    },
    {
      field: 'code',
      title: '模板编号',
      minWidth: 120,
    },
    {
      field: 'name',
      title: '模板名称',
      minWidth: 150,
    },
    {
      field: 'type',
      title: '短信类型',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_SMS_TEMPLATE_TYPE },
      },
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
      field: 'content',
      title: '模板内容',
      minWidth: 200,
    },
    {
      field: 'apiTemplateId',
      title: 'API 模板编号',
      minWidth: 140,
    },
    {
      field: 'channelId',
      title: '渠道编号',
      minWidth: 100,
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

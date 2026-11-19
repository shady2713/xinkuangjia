import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { z } from '#/adapter/form';

/**
 * 构建短信渠道新增与编辑表单配置。
 *
 * @returns 表单字段 Schema 数组
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'id',
      dependencies: {
        triggerFields: [''],
        show: () => false,
      },
    },
    {
      component: 'Select',
      fieldName: 'code',
      label: '短信渠道',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_SMS_CHANNEL_CODE, 'string'),
        placeholder: '请选择短信渠道',
      },
      rules: 'required',
    },
    {
      component: 'Input',
      fieldName: 'signature',
      label: '短信签名',
      componentProps: {
        placeholder: '请输入短信签名',
      },
      rules: 'required',
    },
    {
      fieldName: 'status',
      label: '开启状态',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      },
      rules: z.number().default(CommonStatusEnum.ENABLE),
    },
    {
      component: 'Input',
      fieldName: 'apiKey',
      label: 'API Key',
      componentProps: {
        placeholder: '请输入 API Key',
      },
      rules: 'required',
    },
    {
      component: 'InputPassword',
      fieldName: 'apiSecret',
      label: 'API Secret',
      dependencies: {
        triggerFields: ['id'],
        /**
         * 编辑已有渠道时提示密钥留空即保留原值。
         *
         * @param values 当前表单字段值对象
         * @returns 动态输入框占位提示属性
         */
        componentProps(values) {
          return {
            placeholder: values.id
              ? '留空则保持原密钥不变'
              : '请输入 API Secret',
          };
        },
      },
    },
    {
      component: 'Input',
      fieldName: 'callbackUrl',
      label: '回调地址',
      componentProps: {
        placeholder: '请输入回调地址',
      },
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

/** 列表的搜索表单 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'signature',
      label: '短信签名',
      component: 'Input',
      componentProps: {
        placeholder: '请输入短信签名',
        clearable: true,
      },
    },
    {
      fieldName: 'code',
      label: '短信渠道',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_SMS_CHANNEL_CODE, 'string'),
        placeholder: '请选择短信渠道',
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
 * 构建短信渠道列表的表格列配置。
 *
 * @returns 表格列定义数组
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    {
      field: 'id',
      title: '编号',
      minWidth: 100,
    },
    {
      field: 'signature',
      title: '短信签名',
      minWidth: 120,
    },
    {
      field: 'code',
      title: '渠道编码',
      minWidth: 120,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_SMS_CHANNEL_CODE },
      },
    },
    {
      field: 'status',
      title: '开启状态',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
    },
    {
      field: 'remark',
      title: '备注',
      minWidth: 200,
    },
    {
      field: 'apiKey',
      title: 'API Key',
      minWidth: 180,
    },
    {
      field: 'callbackUrl',
      title: '回调地址',
      minWidth: 200,
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

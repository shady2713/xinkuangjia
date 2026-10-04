/**
 * OAuth2 客户端的表单与列表定义：客户端主键隐藏回填，授权范围按已选范围联动。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { z } from '#/adapter/form';

/**
 * OAuth2 客户端新增/修改的表单定义。
 * @returns 客户端表单的表单项列表。
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'id',
      component: 'Input',
      dependencies: {
        triggerFields: [''],
        /** 隐藏字段不渲染：主键只在提交时回填，不允许用户编辑。 */
        show: () => false,
      },
    },
    {
      fieldName: 'clientId',
      label: '客户端编号',
      component: 'Input',
      componentProps: {
        placeholder: '请输入客户端编号',
      },
      rules: 'required',
    },
    {
      fieldName: 'secret',
      label: '客户端密钥',
      component: 'Input',
      componentProps: {
        placeholder: '请输入客户端密钥',
      },
      rules: 'required',
    },
    {
      fieldName: 'name',
      label: '应用名',
      component: 'Input',
      componentProps: {
        placeholder: '请输入应用名',
      },
      rules: 'required',
    },
    {
      fieldName: 'logo',
      label: '应用图标',
      component: 'ImageUpload',
      rules: 'required',
    },
    {
      fieldName: 'description',
      label: '应用描述',
      component: 'Textarea',
      componentProps: {
        placeholder: '请输入应用描述',
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
      fieldName: 'accessTokenValiditySeconds',
      label: '访问令牌的有效期',
      component: 'InputNumber',
      componentProps: {
        placeholder: '请输入访问令牌的有效期，单位：秒',
        min: 0,
        controlsPosition: 'right',
        class: '!w-full',
      },
      rules: 'required',
    },
    {
      fieldName: 'refreshTokenValiditySeconds',
      label: '刷新令牌的有效期',
      component: 'InputNumber',
      componentProps: {
        placeholder: '请输入刷新令牌的有效期，单位：秒',
        min: 0,
        controlsPosition: 'right',
        class: '!w-full',
      },
      rules: 'required',
    },
    {
      fieldName: 'authorizedGrantTypes',
      label: '授权类型',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_OAUTH2_GRANT_TYPE),
        multiple: true,
        placeholder: '请输入授权类型',
      },
      rules: 'required',
    },
    {
      fieldName: 'scopes',
      label: '授权范围',
      component: 'InputTag',
      componentProps: {
        placeholder: '请输入授权范围',
      },
    },
    {
      fieldName: 'autoApproveScopes',
      label: '自动授权范围',
      component: 'Select',
      componentProps: {
        placeholder: '请输入自动授权范围',
        multiple: true,
        options: [],
      },
      dependencies: {
        triggerFields: ['scopes'],
        /**
         * 授权范围的可选项与已选范围保持一致。
         * @param values 联动时刻的表单值。
         * @returns 与已选范围一一对应的选项列表。
         */
        componentProps: (values) => {
          // 授权范围是字符串列表；联动期间可能尚未选择，这里只处理数组形态。
          const scopes = Array.isArray(values.scopes) ? values.scopes : [];
          return {
            options: scopes.map(
              /** 每个范围同时作为标签与取值，避免用户填入范围外的值。 */
              (scope) => ({
                label: String(scope),
                value: String(scope),
              }),
            ),
          };
        },
      },
    },
    {
      fieldName: 'redirectUris',
      label: '可重定向的 URI 地址',
      component: 'InputTag',
      componentProps: {
        placeholder: '请输入可重定向的 URI 地址',
      },
      rules: 'required',
    },
    {
      fieldName: 'authorities',
      label: '权限',
      component: 'InputTag',
      componentProps: {
        placeholder: '请输入权限',
      },
    },
    {
      fieldName: 'resourceIds',
      label: '资源',
      component: 'InputTag',
      componentProps: {
        placeholder: '请输入资源',
      },
    },
    {
      fieldName: 'additionalInformation',
      label: '附加信息',
      component: 'Textarea',
      componentProps: {
        placeholder: '请输入附加信息，JSON 格式数据',
      },
    },
  ];
}

/**
 * 客户端列表的搜索表单。
 * @returns 列表搜索用的表单项列表。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '应用名',
      component: 'Input',
      componentProps: {
        placeholder: '请输入应用名',
        clearable: true,
      },
    },
    {
      fieldName: 'status',
      label: '状态',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
        clearable: true,
        placeholder: '请输入状态',
      },
    },
  ];
}

/**
 * 把后端以秒为单位的有效期展示为带单位的文本。
 * vxe-table 调用列上的函数式 formatter 时传入的是单元格参数对象（含 cellValue、row、column
 * 等），不能把入参直接当秒数拼接，否则列表会渲染成 “[object Object] 秒”。
 * 0 是合法有效期（表单下限为 0），只有 null/undefined 才是空值并显示空文本。
 * @param formatParams 表格格式化入参。
 * @param formatParams.cellValue 单元格的原始值，单位为秒。
 * @returns 形如“3600 秒”的展示文本；空值返回空串。
 */
function formatSeconds(formatParams: { cellValue?: unknown }) {
  const { cellValue } = formatParams;
  if (cellValue === null || cellValue === undefined) {
    return '';
  }
  return `${cellValue as number} 秒`;
}

/**
 * 客户端列表的表格列定义。
 * @returns 与客户端数据类型匹配的列配置。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'clientId',
      title: '客户端编号',
      minWidth: 120,
    },
    {
      field: 'secret',
      title: '客户端密钥',
      minWidth: 120,
    },
    {
      field: 'name',
      title: '应用名',
      minWidth: 120,
    },
    {
      field: 'logo',
      title: '应用图标',
      minWidth: 100,
      cellRender: {
        name: 'CellImage',
      },
    },
    {
      field: 'status',
      title: '状态',
      minWidth: 80,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.COMMON_STATUS },
      },
    },
    {
      field: 'accessTokenValiditySeconds',
      title: '访问令牌的有效期',
      minWidth: 150,
      formatter: formatSeconds,
    },
    {
      field: 'refreshTokenValiditySeconds',
      title: '刷新令牌的有效期',
      minWidth: 150,
      formatter: formatSeconds,
    },
    {
      field: 'authorizedGrantTypes',
      title: '授权类型',
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
      width: 130,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

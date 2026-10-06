/**
 * 访问令牌列表的检索项与列定义，供令牌管理页查询、删除与批量清理。
 * 令牌由后端在登录与授权时签发刷新，前端不提供新增和编辑入口。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import { DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

/**
 * 访问令牌列表的检索条件：用户编号与客户端编号模糊匹配，用户类型精确匹配。
 * @returns 表单 schema 列表；三项均非必填，清空即表示不按该条件过滤。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'userId',
      label: '用户编号',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户编号',
        clearable: true,
      },
    },
    {
      fieldName: 'userType',
      label: '用户类型',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.USER_TYPE, 'number'),
        placeholder: '请选择用户类型',
        clearable: true,
      },
    },
    {
      fieldName: 'clientId',
      label: '客户端编号',
      component: 'Input',
      componentProps: {
        placeholder: '请输入客户端编号',
        clearable: true,
      },
    },
  ];
}

/**
 * 访问令牌列表的列定义：访问令牌、刷新令牌、用户、客户端与过期/创建时间。
 * @returns 列定义数组；首列为多选列，用户类型用 CellDict 渲染，操作列由父级插槽提供。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'accessToken',
      title: '访问令牌',
      minWidth: 300,
    },
    {
      field: 'refreshToken',
      title: '刷新令牌',
      minWidth: 300,
    },
    {
      field: 'userId',
      title: '用户编号',
      minWidth: 100,
    },
    {
      field: 'userType',
      title: '用户类型',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.USER_TYPE },
      },
    },
    {
      field: 'clientId',
      title: '客户端编号',
      minWidth: 120,
    },
    {
      field: 'expiresTime',
      title: '过期时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      field: 'createTime',
      title: '创建时间',
      minWidth: 180,
      formatter: 'formatDateTime',
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

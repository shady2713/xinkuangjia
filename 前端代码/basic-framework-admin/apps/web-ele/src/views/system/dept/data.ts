import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { OpenApiSchemas } from '#/api/generated/api-types';
import type { SystemDeptApi } from '#/api/system/dept';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';
import { handleTree } from '@vben/utils';

import {
  buildOptionalEmailSchema,
  buildOptionalMobileSchema,
  z,
} from '#/adapter/form';
import { getDeptList } from '#/api/system/dept';
import { getSimpleUserList } from '#/api/system/user';

let userList: OpenApiSchemas.UserSimpleRespVO[] = [];
getSimpleUserList().then((data) => (userList = data));

/**
 * 构建部门新增/编辑表单字段定义。
 *
 * @returns 部门表单配置数组
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'id',
      component: 'Input',
      dependencies: {
        triggerFields: [''],
        show: () => false,
      },
    },
    {
      fieldName: 'parentId',
      label: '上级部门',
      component: 'ApiTreeSelect',
      componentProps: {
        clearable: true,
        /** 拉取部门列表并补齐顶级部门根节点后转换为树形结构。 */
        api: async () => {
          const data: Array<{
            id?: number | string;
            name: string;
            parentId?: number | string;
          }> = [
            {
              id: 0,
              name: '顶级部门',
            },
            ...(await getDeptList()),
          ];
          return handleTree(data);
        },
        labelField: 'name',
        valueField: 'id',
        childrenField: 'children',
        placeholder: '请选择上级部门',
        defaultExpandAll: true,
        checkStrictly: true,
      },
      rules: 'selectRequired',
    },
    {
      fieldName: 'name',
      label: '部门名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入部门名称',
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
      fieldName: 'leaderUserId',
      label: '负责人',
      component: 'ApiSelect',
      componentProps: {
        api: getSimpleUserList,
        labelField: 'nickname',
        valueField: 'id',
        placeholder: '请选择负责人',
        clearable: true,
      },
      rules: z.number().nullish(),
    },
    {
      fieldName: 'phone',
      label: '联系电话',
      component: 'Input',
      componentProps: {
        maxLength: 11,
        placeholder: '请输入联系电话',
      },
      rules: buildOptionalMobileSchema('联系电话'),
    },
    {
      fieldName: 'email',
      label: '邮箱',
      component: 'Input',
      componentProps: {
        placeholder: '请输入邮箱',
      },
      rules: buildOptionalEmailSchema('邮箱'),
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
  ];
}

/**
 * 部门列表的表格列配置
 * @returns 表格列定义
 */
export function useGridColumns(): VxeTableGridOptions<SystemDeptApi.Dept>['columns'] {
  return [
    { type: 'checkbox', width: 40, fixed: 'left' },
    {
      field: 'name',
      title: '部门名称',
      minWidth: 150,
      align: 'left',
      treeNode: true,
    },
    {
      field: 'leaderUserId',
      title: '负责人',
      minWidth: 150,
      // 把负责人编号显示成用户昵称
      formatter: ({ cellValue }) =>
        userList.find(
          // 按单元格中的用户编号匹配负责人昵称
          (user) => String(user.id) === String(cellValue),
        )?.nickname || '-',
    },
    {
      field: 'sort',
      title: '显示顺序',
      minWidth: 100,
    },
    {
      field: 'status',
      title: '部门状态',
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
      width: 220,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

/**
 * 角色管理的三套表单与列表字段：角色编辑、数据权限分配、菜单分配。
 * 数据权限表单只在选中自定义范围时才显示部门范围字段；
 * 菜单树的勾选结果由分配弹窗填充，这里只声明字段与显隐条件。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';

import {
  CommonStatusEnum,
  DICT_TYPE,
  SystemDataScopeEnum,
} from '@vben/constants';
import { getDictOptions } from '@vben/hooks';

import { z } from '#/adapter/form';
import { getRangePickerDefaultProps } from '#/utils';

/**
 * 角色新增/修改弹窗的表单字段：名称、标识与显示顺序必填，状态默认启用。
 * @returns 表单 schema 列表；id 为隐藏字段，仅用于区分新增与编辑。
 */
export function useFormSchema(): VbenFormSchema[] {
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
      label: '角色名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入角色名称',
      },
      rules: 'required',
    },
    {
      fieldName: 'code',
      label: '角色标识',
      component: 'Input',
      componentProps: {
        placeholder: '请输入角色标识',
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
      label: '角色状态',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      },
      rules: z.number().default(CommonStatusEnum.ENABLE),
    },
    {
      fieldName: 'remark',
      label: '角色备注',
      component: 'Textarea',
      componentProps: {
        placeholder: '请输入角色备注',
      },
    },
  ];
}

/**
 * 分配数据权限弹窗的表单字段：角色名称与标识只读回显，权限范围可改，
 * 选择「自定义部门」时才出现部门范围字段。
 * @returns 表单 schema 列表；id 为隐藏字段，部门范围由 dataScope 联动显隐。
 */
export function useAssignDataPermissionFormSchema(): VbenFormSchema[] {
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
      fieldName: 'name',
      label: '角色名称',
      component: 'Input',
      componentProps: {
        disabled: true,
      },
    },
    {
      component: 'Input',
      fieldName: 'code',
      label: '角色标识',
      componentProps: {
        disabled: true,
      },
    },
    {
      component: 'Select',
      fieldName: 'dataScope',
      label: '权限范围',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_DATA_SCOPE, 'number'),
      },
    },
    {
      fieldName: 'dataScopeDeptIds',
      label: '部门范围',
      component: 'Input',
      formItemClass: 'items-start',
      dependencies: {
        triggerFields: ['dataScope'],
        /** 部门范围只在权限范围选为「自定义部门」时出现，其余范围沿用角色已有的数据权限。 */
        show: (values) => {
          return values.dataScope === SystemDataScopeEnum.DEPT_CUSTOM;
        },
      },
    },
  ];
}

/**
 * 分配菜单弹窗的表单字段：角色名称与标识只读回显，菜单勾选由弹窗内的树组件承载。
 * @returns 表单 schema 列表；id 为隐藏字段，随记录带回以便提交时定位角色。
 */
export function useAssignMenuFormSchema(): VbenFormSchema[] {
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
      label: '角色名称',
      component: 'Input',
      componentProps: {
        disabled: true,
      },
    },
    {
      fieldName: 'code',
      label: '角色标识',
      component: 'Input',
      componentProps: {
        disabled: true,
      },
    },
    {
      fieldName: 'menuIds',
      label: '菜单权限',
      component: 'Input',
      formItemClass: 'items-start',
    },
  ];
}

/**
 * 角色列表的检索条件：名称与标识模糊匹配，状态精确匹配，创建时间按区间筛选。
 * @returns 表单 schema 列表；各项均非必填，清空即表示不按该条件过滤。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'name',
      label: '角色名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入角色名称',
        clearable: true,
      },
    },
    {
      fieldName: 'code',
      label: '角色标识',
      component: 'Input',
      componentProps: {
        placeholder: '请输入角色标识',
        clearable: true,
      },
    },
    {
      fieldName: 'status',
      label: '角色状态',
      component: 'Select',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
        placeholder: '请选择角色状态',
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
 * 角色列表的列定义：编号、名称、类型、标识、显示顺序、备注、状态与创建时间。
 * @returns 列定义数组；首列为多选列，类型与状态用 CellDict 渲染，操作列由父级插槽提供。
 */
export function useGridColumns(): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '角色编号',
      minWidth: 100,
    },
    {
      field: 'name',
      title: '角色名称',
      minWidth: 200,
    },
    {
      field: 'type',
      title: '角色类型',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_ROLE_TYPE },
      },
    },
    {
      field: 'code',
      title: '角色标识',
      minWidth: 200,
    },
    {
      field: 'sort',
      title: '显示顺序',
      minWidth: 100,
    },
    {
      field: 'remark',
      title: '角色备注',
      minWidth: 100,
    },
    {
      field: 'status',
      title: '角色状态',
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
      width: 240,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

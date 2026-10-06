/**
 * 系统用户页表单与列表定义：新增/修改、重置密码、分配角色、导入与搜索表单。
 * 供用户列表页及其弹窗复用；只描述字段与校验，增删改查请求由页面发起。
 */
import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemPostApi } from '#/api/system/post';
import type { SystemRoleApi } from '#/api/system/role';
import type { SystemUserApi } from '#/api/system/user';

import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { getDictOptions } from '@vben/hooks';
import { $t } from '@vben/locales';
import { handleTree } from '@vben/utils';

import { z } from '#/adapter/form';
import { getDeptList } from '#/api/system/dept';
import { getSimplePostList } from '#/api/system/post';
import { getSimpleRoleList } from '#/api/system/role';
import { getRangePickerDefaultProps } from '#/utils';

/**
 * 新增/修改用户时使用的表单字段定义。
 * @returns 表单 schema 数组，字段与用户接口的读写模型一一对应。
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
      fieldName: 'username',
      label: '用户名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户名称',
      },
      rules: 'required',
    },
    {
      label: '用户密码',
      fieldName: 'password',
      // 新增用户时复用个人中心的新密码前端校验，统一密码输入体验和复杂度提示。
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: '请输入用户密码',
      },
      rules: 'passwordRequired',
      dependencies: {
        triggerFields: ['id'],
        /** 密码只在新增时录入；编辑已有用户时该字段隐藏，改密走重置密码入口。 */
        show: (values) => !values.id,
      },
    },
    {
      fieldName: 'nickname',
      label: '用户昵称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户昵称',
      },
      rules: 'required',
    },
    {
      fieldName: 'deptId',
      label: '归属部门',
      component: 'ApiTreeSelect',
      componentProps: {
        /** 归属部门候选取自真实部门列表并转成树；这里不追加虚拟顶级节点，只能选到已存在的部门。 */
        api: async () => {
          const data = await getDeptList();
          return handleTree(data);
        },
        labelField: 'name',
        valueField: 'id',
        childrenField: 'children',
        placeholder: '请选择归属部门',
        defaultExpandAll: true,
        checkStrictly: true,
      },
    },
    {
      fieldName: 'postIds',
      label: '岗位',
      component: 'ApiSelect',
      componentProps: {
        api: getSimplePostList,
        labelField: 'name',
        valueField: 'id',
        multiple: true,
        placeholder: '请选择岗位',
        // 按岗位状态置灰不可选项，其余字段原样透传。
        afterFetch: async (res: SystemPostApi.Post[]) =>
          res.map((item) => ({
            ...item,
            disabled: item.status === CommonStatusEnum.DISABLE,
          })),
      },
    },
    {
      fieldName: 'email',
      label: '邮箱',
      component: 'Input',
      rules: z.string().email('邮箱格式不正确').or(z.literal('')).optional(),
      componentProps: {
        placeholder: '请输入邮箱',
      },
    },
    {
      fieldName: 'mobile',
      label: '手机号码',
      component: 'Input',
      rules: z
        .string()
        .regex(/^1[3-9]\d{9}$/, '手机号码格式不正确')
        .or(z.literal(''))
        .optional(),
      componentProps: {
        placeholder: '请输入手机号码',
      },
    },
    {
      fieldName: 'sex',
      label: '用户性别',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_USER_SEX, 'number'),
      },
      rules: z.number().default(1),
    },
    {
      fieldName: 'status',
      label: '用户状态',
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
 * 重置密码弹窗的表单字段：新密码与确认密码两次录入，长度 5-20 位且两者必须一致。
 * @returns 表单 schema 列表；id 为隐藏字段，新旧密码相同或两次输入不一致时校验不通过。
 */
export function useResetPasswordFormSchema(): VbenFormSchema[] {
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
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: '请输入新密码',
      },
      dependencies: {
        /**
         * 新密码的前端校验：长度 5-20 位，且不得与旧密码相同。
         * @param values 当前表单全部取值，用其中的 oldPassword 判断新旧是否重复。
         * @returns 校验新密码的 zod 规则。
         */
        rules(values) {
          return z
            .string({ message: '请输入新密码' })
            .min(5, '密码长度不能少于 5 个字符')
            .max(20, '密码长度不能超过 20 个字符')
            .refine(
              (value) => value !== values.oldPassword,
              '新旧密码不能相同',
            );
        },
        triggerFields: ['newPassword', 'oldPassword'],
      },
      fieldName: 'newPassword',
      label: '新密码',
      rules: 'required',
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        passwordStrength: true,
        placeholder: $t('authentication.confirmPassword'),
      },
      dependencies: {
        /**
         * 确认密码的前端校验：长度 5-20 位，且必须与新密码一致。
         * @param values 当前表单全部取值，用其中的 newPassword 判断两次输入是否一致。
         * @returns 校验确认密码的 zod 规则。
         */
        rules(values) {
          return z
            .string({ message: '请输入确认密码' })
            .min(5, '密码长度不能少于 5 个字符')
            .max(20, '密码长度不能超过 20 个字符')
            .refine(
              (value) => value === values.newPassword,
              '新密码和确认密码不一致',
            );
        },
        triggerFields: ['newPassword', 'confirmPassword'],
      },
      fieldName: 'confirmPassword',
      label: '确认密码',
      rules: 'required',
    },
  ];
}

/**
 * 为已有用户分配角色时使用的表单字段定义。
 * @returns 表单 schema 数组，岗位与角色均以多选下拉呈现。
 */
export function useAssignRoleFormSchema(): VbenFormSchema[] {
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
      fieldName: 'username',
      label: '用户名称',
      component: 'Input',
      componentProps: {
        disabled: true,
      },
    },
    {
      fieldName: 'nickname',
      label: '用户昵称',
      component: 'Input',
      componentProps: {
        disabled: true,
      },
    },
    {
      fieldName: 'roleIds',
      label: '角色',
      component: 'ApiSelect',
      componentProps: {
        api: getSimpleRoleList,
        labelField: 'name',
        valueField: 'id',
        multiple: true,
        placeholder: '请选择角色',
        // 按角色状态置灰不可选项，其余字段原样透传。
        afterFetch: async (res: SystemRoleApi.Role[]) =>
          res.map((item) => ({
            ...item,
            disabled: item.status === CommonStatusEnum.DISABLE,
          })),
      },
    },
  ];
}

/**
 * 用户导入弹窗的表单字段：选择一个 xls/xlsx 文件，并决定是否覆盖已存在的用户。
 * @returns 表单 schema 列表；覆盖开关默认为否，避免误改既有用户数据。
 */
export function useImportFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'file',
      label: '用户数据',
      component: 'Upload',
      rules: 'required',
      help: '仅允许导入 xls、xlsx 格式文件',
    },
    {
      fieldName: 'updateSupport',
      label: '是否覆盖',
      component: 'Switch',
      componentProps: {
        checkedChildren: '是',
        unCheckedChildren: '否',
      },
      rules: z.boolean().default(false),
      help: '是否更新已经存在的用户数据',
    },
  ];
}

/**
 * 用户列表的检索条件：用户名称与手机号码模糊匹配，创建时间按区间筛选。
 * @returns 表单 schema 列表；三项均非必填，清空即表示不按该条件过滤。
 */
export function useGridFormSchema(): VbenFormSchema[] {
  return [
    {
      fieldName: 'username',
      label: '用户名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入用户名称',
        clearable: true,
      },
    },
    {
      fieldName: 'mobile',
      label: '手机号码',
      component: 'Input',
      componentProps: {
        placeholder: '请输入手机号码',
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
 * 用户列表的列定义：编号、名称、昵称、部门、手机号、状态与创建时间。
 * @param onStatusChange 状态开关变更前的回调，返回 false 时不写回行数据；不传则该列只展示状态。
 * @returns 列定义数组；首列为多选列，状态列用 CellSwitch 渲染并接入 onStatusChange。
 */
export function useGridColumns(
  onStatusChange?: /** 状态开关变更回调的类型：入参为新状态与当前行，返回 false 时放弃写回。 */ (
    newStatus: number,
    row: SystemUserApi.User,
  ) => PromiseLike<boolean | undefined>,
): VxeTableGridOptions['columns'] {
  return [
    { type: 'checkbox', width: 40 },
    {
      field: 'id',
      title: '用户编号',
      minWidth: 100,
    },
    {
      field: 'username',
      title: '用户名称',
      minWidth: 120,
    },
    {
      field: 'nickname',
      title: '用户昵称',
      minWidth: 120,
    },
    {
      field: 'deptName',
      title: '部门',
      minWidth: 120,
    },
    {
      field: 'mobile',
      title: '手机号码',
      minWidth: 120,
    },
    {
      field: 'status',
      title: '状态',
      minWidth: 100,
      align: 'center',
      cellRender: {
        attrs: { beforeChange: onStatusChange },
        name: 'CellSwitch',
        props: {
          activeValue: CommonStatusEnum.ENABLE,
          inactiveValue: CommonStatusEnum.DISABLE,
        },
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
      width: 180,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

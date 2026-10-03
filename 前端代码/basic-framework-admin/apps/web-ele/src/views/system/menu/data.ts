/** 菜单管理页面的表单与列表定义：按菜单类型联动展示字段，并提供表格列配置。 */
import type { Recordable } from '@vben/types';

import type { VbenFormSchema } from '#/adapter/form';
import type { VxeTableGridOptions } from '#/adapter/vxe-table';
import type { SystemMenuApi } from '#/api/system/menu';

import { h } from 'vue';

import {
  CommonStatusEnum,
  DICT_TYPE,
  SystemMenuTypeEnum,
} from '@vben/constants';
import { getDictOptions } from '@vben/hooks';
import { IconifyIcon } from '@vben/icons';
import { handleTree, isHttpUrl } from '@vben/utils';

import { z } from '#/adapter/form';
import { getMenuList } from '#/api/system/menu';
import { $t } from '#/locales';
import { componentKeys } from '#/router/routes';

/** 目录与菜单类型都展示图标、路径等字段。 */
const DIR_AND_MENU = [SystemMenuTypeEnum.DIR, SystemMenuTypeEnum.MENU];

/** 组件名自动完成的单个候选项：value 是路由登记过的真实组件名。 */
type ComponentNameOption = { value: string };

/** 自动完成的候选回调：控件按关键字过滤后回传候选列表。 */
type SuggestionCallback = (options: ComponentNameOption[]) => void;

/**
 * 判断当前菜单类型是否属于给定集合。
 * @param values 联动时刻的表单值，类型字段可能尚未选择。
 * @param types 允许展示的菜单类型。
 * @returns 命中返回 true；类型缺失或不匹配返回 false。
 */
function isMenuType(values: Partial<Record<string, unknown>>, types: number[]) {
  const type = values.type;
  return typeof type === 'number' && types.includes(type);
}

/**
 * 新增/修改菜单的表单定义：按菜单类型联动展示字段与校验规则。
 * @returns 菜单表单的表单项列表。
 */
export function useFormSchema(): VbenFormSchema[] {
  return [
    {
      component: 'Input',
      fieldName: 'id',
      dependencies: {
        triggerFields: [''],

        /** 隐藏字段不渲染：主键只在提交时回填，不允许用户编辑。 */

        show: () => false,
      },
    },
    {
      fieldName: 'parentId',
      label: '上级菜单',
      component: 'ApiTreeSelect',
      componentProps: {
        clearable: true,

        /** 上级菜单选项来自后端菜单树，并补一个顶级菜单占位。 */

        api: async () => {
          const data = await getMenuList();
          data.unshift({
            id: 0,
            name: '顶级部门',
          } as SystemMenuApi.Menu);
          return handleTree(data);
        },
        labelField: 'name',
        valueField: 'id',
        childrenField: 'children',
        placeholder: '请选择上级菜单',
        /**
         * 按菜单名过滤树节点：同时匹配原始名与翻译后的文本。
         * @param input 当前搜索关键字。
         * @param node 待判断的树节点。
         * @returns 命中返回 true；节点没有可用名称时返回 false。
         */
        filterTreeNode(input: string, node: Recordable<unknown>) {
          if (!input || input.length === 0) {
            return true;
          }
          const name = String(node.label ?? '');
          if (!name) return false;
          return name.includes(input) || $t(name).includes(input);
        },
        showSearch: true,
        defaultExpandedKeys: [0],
        checkStrictly: true,
      },
      rules: 'selectRequired',
      /**
       * 组装树选择项的展示内容，兼容带图标与不带图标两种情况。
       * @returns 具名插槽到渲染函数的映射。
       */
      renderComponentContent() {
        return {
          /**
           * 渲染树选择项：按选中项的 label 与 icon 组装展示内容。
           * @param slotProps 组件默认插槽参数，label 与 icon 都可能缺失。
           * @returns 展示节点；未选中任何项时返回空串。
           */
          title(slotProps?: Record<string, unknown>) {
            const label =
              typeof slotProps?.label === 'string' ? slotProps.label : '';
            const icon =
              typeof slotProps?.icon === 'string' ? slotProps.icon : '';
            const components = [];
            if (!label) return '';
            if (icon) {
              components.push(h(IconifyIcon, { class: 'size-4', icon }));
            }
            components.push(h('span', { class: '' }, $t(label || '')));
            return h('div', { class: 'flex items-center gap-1' }, components);
          },
        };
      },
    },
    {
      fieldName: 'name',
      label: '菜单名称',
      component: 'Input',
      componentProps: {
        placeholder: '请输入菜单名称',
      },
      rules: 'required',
    },
    {
      fieldName: 'type',
      label: '菜单类型',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.SYSTEM_MENU_TYPE, 'number'),
      },
      rules: z.number().default(SystemMenuTypeEnum.DIR),
    },
    {
      fieldName: 'icon',
      label: '菜单图标',
      component: 'IconPicker',
      componentProps: {
        placeholder: '请选择菜单图标',
        prefix: 'carbon',
      },
      rules: 'required',
      dependencies: {
        triggerFields: ['type'],

        /** 图标只对目录与菜单展示，按钮类型不涉及页面跳转。 */

        show: (values) => {
          return isMenuType(values, DIR_AND_MENU);
        },
      },
    },
    {
      fieldName: 'path',
      label: '路由地址',
      component: 'Input',
      componentProps: {
        placeholder: '请输入路由地址',
      },
      rules: z.string(),
      help: '访问的路由地址，如：`user`。如需外网地址时，则以 `http(s)://` 开头',
      dependencies: {
        triggerFields: ['type', 'parentId'],

        /** 路由地址只对目录与菜单展示，按钮类型没有路由。 */

        show: (values) => {
          return isMenuType(values, DIR_AND_MENU);
        },
        /**
         * 按父级位置决定路由地址的斜杠规则：顶级用绝对路径，其余用相对路径。
         * @param values 联动时刻的表单值。
         * @returns 该位置适用的路由地址校验规则。
         */
        rules: (values) => {
          const schema = z.string().min(1, '路由地址不能为空');
          // 联动期间路由地址可能尚未输入，这里按空串处理：顶级菜单补斜杠规则。
          const path = typeof values.path === 'string' ? values.path : '';
          if (isHttpUrl(path)) {
            return schema;
          }
          if (values.parentId === 0) {
            return schema.refine(
              /** 顶级菜单的路由地址必须是绝对路径。 */
              (path) => path.charAt(0) === '/',
              '路径必须以 / 开头',
            );
          }
          return schema.refine(
            /** 非顶级菜单的路由地址必须是相对路径。 */
            (path) => path.charAt(0) !== '/',
            '路径不能以 / 开头',
          );
        },
      },
    },
    {
      fieldName: 'component',
      label: '组件地址',
      component: 'Input',
      componentProps: {
        placeholder: '请输入组件地址',
      },
      dependencies: {
        triggerFields: ['type'],

        /** 组件地址只对菜单类型有意义，目录与按钮都不填。 */

        show: (values) => {
          return isMenuType(values, [SystemMenuTypeEnum.MENU]);
        },
      },
    },
    {
      fieldName: 'componentName',
      label: '组件名称',
      component: 'AutoComplete',
      componentProps: {
        clearable: true,
        /**
         * 按输入的关键字过滤可用的组件名称候选项。
         * @param queryString 自动完成框当前的关键字。
         * @param cb 候选列表回调，由控件在需要时调用。
         */
        fetchSuggestions(queryString: string, cb: SuggestionCallback) {
          /** 候选列表来自路由模块登记过的真实组件名。 */
          const options = componentKeys.map(
            /** 每个路由组件名对应一个候选项。 */
            (v) => ({ value: v }),
          );
          /** 生成一个按关键字过滤候选项的匹配函数。 */
          const createFilter = (qs: string) => {
            return (
              /** 单个候选项的匹配规则：忽略大小写的包含匹配。 */
              (option: ComponentNameOption) => {
                return option.value.toLowerCase().includes(qs.toLowerCase());
              }
            );
          };
          const results = queryString
            ? options.filter(createFilter(queryString))
            : options;
          cb(results);
        },
        placeholder: '请选择组件名称',
      },
      dependencies: {
        triggerFields: ['type'],

        /** 组件名称与组件地址同属菜单类型，按钮与目录都不需要。 */

        show: (values) => {
          return isMenuType(values, [SystemMenuTypeEnum.MENU]);
        },
      },
    },
    {
      fieldName: 'permission',
      label: '权限标识',
      component: 'Input',
      componentProps: {
        placeholder: '请输入菜单描述',
      },
      dependencies: {
        /** 权限标识用于按钮与菜单，目录本身不对外暴露权限。 */
        show: (values) => {
          return isMenuType(values, [
            SystemMenuTypeEnum.BUTTON,
            SystemMenuTypeEnum.MENU,
          ]);
        },
        triggerFields: ['type'],
      },
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
      label: '菜单状态',
      component: 'RadioGroup',
      componentProps: {
        options: getDictOptions(DICT_TYPE.COMMON_STATUS, 'number'),
      },
      rules: z.number().default(CommonStatusEnum.ENABLE),
    },
    {
      fieldName: 'visible',
      label: '显示状态',
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '显示', value: true },
          { label: '隐藏', value: false },
        ],
      },
      rules: 'required',
      defaultValue: true,
      help: '选择隐藏时，路由将不会出现在侧边栏，但仍然可以访问',
      dependencies: {
        triggerFields: ['type'],

        /** 显示状态只对目录与菜单生效，按钮由所在页面的权限控制。 */

        show: (values) => {
          return isMenuType(values, DIR_AND_MENU);
        },
      },
    },
    {
      fieldName: 'alwaysShow',
      label: '总是显示',
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '总是', value: true },
          { label: '不是', value: false },
        ],
      },
      /** 菜单列表的表格列定义。
       * @returns 与菜单数据类型匹配的列配置。 */
      rules: 'required',
      defaultValue: true,
      help: '选择不是时，当该菜单只有一个子菜单时，不展示自己，直接展示子菜单',
      dependencies: {
        triggerFields: ['type'],

        /** “总是显示”只对菜单类型有意义，目录与按钮不涉及。 */

        show: (values) => {
          return isMenuType(values, [SystemMenuTypeEnum.MENU]);
        },
      },
    },
    {
      fieldName: 'keepAlive',
      label: '缓存状态',
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '缓存', value: true },
          { label: '不缓存', value: false },
        ],
      },
      rules: 'required',
      defaultValue: true,
      help: '选择缓存时，则会被 `keep-alive` 缓存，必须填写「组件名称」字段',
      dependencies: {
        triggerFields: ['type'],

        /** “缓存状态”只对菜单类型有意义，目录与按钮不涉及。 */

        show: (values) => {
          return isMenuType(values, [SystemMenuTypeEnum.MENU]);
        },
      },
    },
  ];
}

/**
 * 菜单列表的表格列定义。
 * @returns 与菜单数据类型匹配的列配置。
 */
export function useGridColumns(): VxeTableGridOptions<SystemMenuApi.Menu>['columns'] {
  return [
    {
      field: 'name',
      title: '菜单名称',
      minWidth: 250,
      align: 'left',
      fixed: 'left',
      slots: { default: 'name' },
      treeNode: true,
    },
    {
      field: 'type',
      title: '菜单类型',
      minWidth: 100,
      cellRender: {
        name: 'CellDict',
        props: { type: DICT_TYPE.SYSTEM_MENU_TYPE },
      },
    },
    {
      field: 'sort',
      title: '显示排序',
      minWidth: 100,
    },
    {
      field: 'permission',
      title: '权限标识',
      minWidth: 200,
    },
    {
      field: 'path',
      title: '组件路径',
      minWidth: 200,
    },
    {
      field: 'componentName',
      title: '组件名称',
      minWidth: 200,
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
      title: '操作',
      width: 220,
      fixed: 'right',
      slots: { default: 'actions' },
    },
  ];
}

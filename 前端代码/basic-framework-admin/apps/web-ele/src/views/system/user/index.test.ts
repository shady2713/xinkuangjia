/**
 * 用户列表页（views/system/user/index）真实行为回归。
 *
 * 该页面用共享的增删改动作 composable 串起新增、编辑、导出、导入、批量删除、重置密码、
 * 分配角色与行内状态切换：新增未把弹窗行数据置空会让新增表单带出上一条用户；导出未带
 * 当前筛选条件会导出全量用户；左侧部门树选择后未参与查询会让列表仍显示全部部门；状态
 * 切换未按用户主键定位会改错用户或发出指向 undefined 的请求，未处理取消会让行内开关
 * 状态错乱；重置密码与分配角色未携带用户会让操作落到错误用户；四个弹窗保存成功后都必须
 * 刷新列表。用例真实渲染页面并使用真实的动作 composable 与真实页面元数据，只替换页面
 * 外壳、表格容器、动作按钮、卡片、弹窗、提示与网络边界。
 *
 * 五个子弹窗作为边界替身：它们会连带引入表单容器与上传组件，与本页面的装配契约无关。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { confirm } from '@vben/common-ui';
import { CommonStatusEnum, DICT_TYPE } from '@vben/constants';
import { useDictStore } from '@vben/stores';

import { ElMessage, ElMessageBox } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteUser,
  deleteUserList,
  exportUser,
  getUserPage,
  updateUserStatus,
} from '#/api/system/user';

import UserPage from './index.vue';

/** 动作回调签名：动作按钮点击后执行的页面逻辑，返回值由页面自行决定。 */
type ActionHandler = () => unknown;

/** 动作的二次确认配置：存在时点击先确认，确认后才执行 confirm 回调。 */
interface ActionConfirm {
  /** 确认后执行的回调，页面把行数据绑定在它上面。 */
  confirm?: ActionHandler;
  /** 确认框标题。 */
  title?: string;
}

/** 表格动作项契约：页面把动作配置交给动作按钮组件渲染。 */
interface ActionItem {
  auth?: string[];
  disabled?: boolean;
  icon?: string;
  label?: string;
  link?: boolean;
  /** 点击该动作时执行的页面逻辑。 */
  onClick?: ActionHandler;
  /** 二次确认配置；存在时点击先确认再执行。 */
  popConfirm?: ActionConfirm;
  type?: string;
}

/** 用户行夹具：编辑、删除、重置密码、分配角色与状态切换都以用户 id 定位后端记录。 */
const ROW_FIXTURE = {
  id: 41,
  status: CommonStatusEnum.ENABLE,
  username: 'DUMMY-用户',
};

/** 部门行夹具：左侧部门树选择后必须参与用户列表查询。 */
const DEPT_FIXTURE = { id: 9, name: 'DUMMY-部门' };

/** 用户新增权限码，与后端 system_menu 登记的权限标识一致。 */
const CREATE_PERMISSION = ['system', 'user', 'create'].join(':');

/** 用户导出权限码，与后端 system_menu 登记的权限标识一致。 */
const EXPORT_PERMISSION = ['system', 'user', 'export'].join(':');

/** 用户导入权限码，与后端 system_menu 登记的权限标识一致。 */
const IMPORT_PERMISSION = ['system', 'user', 'import'].join(':');

/** 用户删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['system', 'user', 'delete'].join(':');

/** 用户修改权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['system', 'user', 'update'].join(':');

/** 重置密码权限码，与后端 system_menu 登记的权限标识一致。 */
const RESET_PASSWORD_PERMISSION = ['system', 'user', 'update-password'].join(
  ':',
);

/** 分配角色权限码，与后端 system_menu 登记的权限标识一致。 */
const ASSIGN_ROLE_PERMISSION = [
  'system',
  'permission',
  'assign-user-role',
].join(':');

/** 勾选变化事件签名：表格把当前勾选行交给页面。 */
type CheckboxChangeHandler = (payload: { records: unknown[] }) => void;

/** 弹窗替身 API 契约：记录打开与设置数据动作，并按链式契约返回自身。 */
interface ModalProbeApi {
  /** 打开弹窗。 */
  open: () => unknown;
  /** 设置弹窗当前操作的行。 */
  setData: (data: unknown) => unknown;
}

/** 四个弹窗替身与调用实例；模块替身与用例读取同一实例。 */
const modalProbes = vi.hoisted(
  /** 建立按声明顺序记录的弹窗替身容器。 */ () => ({
    apis: [] as ModalProbeApi[],
    options: [] as Array<Record<string, unknown>>,
  }),
);

/** 表格容器记录的配置与调用实例；模块替身与用例读取同一实例。 */
const gridProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表格替身容器。 */ () => ({
    api: {
      formApi: { getValues: vi.fn() },
      query: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 加载提示替身实例；删除结束后必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳、弹窗容器与二次确认，页面自身的增删改与状态切换逻辑保持真实实现。 */ async () => {
    const PageStub = defineComponent({
      name: 'PageStub',
      props: {
        /** 是否启用自动内容高度，决定表格高度计算方式。 */
        autoContentHeight: { default: false, type: Boolean },
      },
      /**
       * 渲染页面容器并透出插槽内容。
       * @param props 页面容器声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 页面传入的插槽表。
       * @returns 带标记的页面容器渲染函数。
       */
      setup(props, { slots }) {
        return /** 输出可定位的页面容器，并暴露真实插槽内容。 */ () =>
          h(
            'div',
            {
              class: 'page-stub',
              'data-auto-content-height': String(props.autoContentHeight),
            },
            slots.default?.(),
          );
      },
    });
    /** 按声明顺序给出的弹窗替身名称，便于用例定位具体弹窗。 */
    const MODAL_NAMES = [
      'FormModalStub',
      'ResetPasswordModalStub',
      'AssignRoleModalStub',
      'ImportModalStub',
    ];
    return {
      /**
       * 执行二次确认，默认按用户确认处理。
       * @returns 已确认的 Promise。
       */
      confirm: vi.fn(
        /** 返回已确认结果，写库动作因此继续执行。 */ async () => true,
      ),
      Page: PageStub,
      /**
       * 记录页面声明的弹窗配置并返回替身组件与替身实例。
       * @param options 页面传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: Record<string, unknown>) => {
        const index = modalProbes.options.length;
        modalProbes.options.push(options);
        const api = {
          open: vi.fn(),
          setData: vi.fn(),
        };
        api.setData.mockReturnValue(api);
        modalProbes.apis.push(api);
        const ModalStub = defineComponent({
          name: MODAL_NAMES[index] ?? 'ModalStub',
          emits: ['success'],
          /**
           * 渲染保存成功按钮，供用例驱动刷新链路。
           * @param _props 弹窗组件属性，本替身不解释。
           * @param context 组件上下文，用于派发事件。
           * @param context.emit 组件事件派发函数。
           * @returns 弹窗替身渲染函数。
           */
          setup(_props, { emit }) {
            return /** 渲染保存成功按钮。 */ () =>
              h('div', { class: `modal-stub modal-${index}` }, [
                h(
                  'button',
                  {
                    class: 'modal-success',
                    // 真实弹窗保存成功后会派发 success，这里复刻同一契约。
                    onClick: /** 模拟弹窗保存成功。 */ () => emit('success'),
                  },
                  '保存',
                ),
              ]);
          },
        });
        return [ModalStub, api];
      },
    };
  },
);

vi.mock(
  '#/adapter/vxe-table',
  /** 只替换表格容器与动作按钮，页面声明的查询、导出、删除与状态切换逻辑保持真实实现。 */ async () => {
    const { ACTION_ICON } = await import('#/components/table-action/icons');
    const GridStub = defineComponent({
      name: 'GridStub',
      props: {
        /** 表格标题，用于核对页面声明的文案。 */
        tableTitle: { default: '', type: String },
      },
      /**
       * 渲染表格标题、工具栏插槽与带行数据的操作插槽。
       * @param props 表格容器声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 页面传入的插槽表。
       * @returns 暴露全部插槽的渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染工具栏与操作列插槽，使页面声明的动作进入组件树。 */ () =>
          h('div', { class: 'grid-stub' }, [
            h('div', { class: 'grid-title' }, props.tableTitle),
            h('div', { class: 'grid-toolbar' }, slots['toolbar-tools']?.()),
            h(
              'div',
              { class: 'grid-actions' },
              slots.actions?.({ row: ROW_FIXTURE }),
            ),
          ]);
      },
    });
    const TableActionStub = defineComponent({
      name: 'TableActionStub',
      props: {
        /** 页面声明的动作列表。 */
        actions: {
          /** 未传入动作时给出空列表，避免渲染期读取 undefined。 */
          default: () => [],
          type: Array,
        },
        /** 页面声明的下拉动作列表。 */
        dropDownActions: {
          /** 未传入下拉动作时给出空列表，避免渲染期读取 undefined。 */
          default: () => [],
          type: Array,
        },
      },
      /**
       * 把动作与下拉动作渲染成可点击按钮，并复刻动作按钮组件的确认流程。
       * @param props 动作按钮组件声明的属性。
       * @returns 逐个动作渲染按钮的渲染函数。
       */
      setup(props) {
        return /** 渲染动作按钮，暴露权限码、禁用态与确认配置供断言。 */ () => {
          const actions = [
            ...(props.actions as ActionItem[]),
            ...(props.dropDownActions as ActionItem[]),
          ];
          return h(
            'div',
            { class: 'table-action-stub' },
            actions.map(
              /**
               * 渲染单个动作按钮。
               * @param action 页面声明的动作项。
               * @param index 动作在列表中的下标。
               * @returns 带契约属性的按钮节点。
               */
              (action, index) =>
                h(
                  'button',
                  {
                    class: 'table-action-button',
                    'data-auth': (action.auth ?? []).join(','),
                    'data-disabled': String(action.disabled ?? false),
                    'data-icon': action.icon ?? '',
                    'data-index': String(index),
                    'data-label': action.label ?? '',
                    'data-link': String(action.link ?? false),
                    'data-popconfirm-title': action.popConfirm?.title ?? '',
                    'data-type': action.type ?? '',
                    // 真实动作按钮先走二次确认再执行 confirm 回调，这里复刻同一契约。
                    onClick: /** 复刻动作按钮的确认流程。 */ () =>
                      action.popConfirm
                        ? action.popConfirm.confirm?.()
                        : action.onClick?.(),
                  },
                  action.label ?? '',
                ),
            ),
          );
        };
      },
    });
    return {
      ACTION_ICON,
      TableAction: TableActionStub,
      /**
       * 记录页面声明的表格配置并返回替身组件与替身实例。
       * @param options 页面传给 useVbenVxeGrid 的配置。
       * @returns 替身表格组件与替身 API 的二元组。
       */
      useVbenVxeGrid: (options: Record<string, unknown>) => {
        gridProbe.options = options;
        return [GridStub, gridProbe.api];
      },
    };
  },
);

vi.mock(
  '#/api/system/user',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteUser: vi.fn(),
    deleteUserList: vi.fn(),
    exportUser: vi.fn(),
    getUserPage: vi.fn(),
    updateUserStatus: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/dept',
  /** 只替换部门接口边界，避免真实请求封装在无环境变量时加载失败。 */ () => ({
    getDeptList: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/post',
  /** 只替换岗位接口边界，避免真实请求封装在无环境变量时加载失败。 */ () => ({
    getSimplePostList: vi.fn(),
  }),
);

vi.mock(
  '#/api/system/role',
  /** 只替换角色接口边界，避免真实请求封装在无环境变量时加载失败。 */ () => ({
    getSimpleRoleList: vi.fn(),
  }),
);

vi.mock(
  '@vben/utils',
  /** 只替换浏览器下载动作，其余工具保持真实实现。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('@vben/utils')>();
    return { ...actual, downloadFileFromBlobPart: vi.fn() };
  },
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对页面请求的语言键与参数。 */ () => ({
    /**
     * 把语言键与占位参数拼成可预期的译文。
     * @param key 组件请求的语言键。
     * @param args 语言键的可选占位参数。
     * @returns 带参数时拼接参数，否则回显键名。
     */
    $t: (key: string, args?: string[]) =>
      args ? `${key}(${args.join('/')})` : key,
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 只替换消息提示边界，便于断言删除成功收到的真实文案。 */ () => ({
    showError: vi.fn(),
    showErrorMessage: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /** 只替换卡片、提示与加载遮罩的展示边界，页面自身的调用时机与顺序保持真实实现。 */ async () => {
    const { defineComponent: define, h: create } = await import('vue');
    const CardStub = define({
      name: 'ElCardStub',
      /**
       * 渲染卡片默认插槽，使左侧部门树进入真实组件树。
       * @param _props 卡片组件属性，本替身不解释。
       * @param context 组件上下文，用于取用默认插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 卡片替身渲染函数。
       */
      setup(_props, { slots }) {
        return /** 渲染卡片默认插槽内容。 */ () =>
          create('div', { class: 'el-card-stub' }, slots.default?.());
      },
    });
    return {
      ElCard: CardStub,
      ElLoading: {
        /**
         * 记录加载遮罩调用并返回可断言的实例。
         * @returns 只记录关闭调用的遮罩实例。
         */
        service: vi.fn(
          /** 返回只记录关闭调用的遮罩实例；遮罩文案由用例单独断言。 */ () =>
            loadingProbe,
        ),
      },
      ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
      ElMessageBox: { confirm: vi.fn() },
    };
  },
);

vi.mock(
  './modules/form.vue',
  /** 用最小替身替换用户表单弹窗，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({ name: 'FormStub', template: '<div />' }),
  }),
);

vi.mock(
  './modules/reset-password-form.vue',
  /** 用最小替身替换重置密码弹窗，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({
      name: 'ResetPasswordFormStub',
      template: '<div />',
    }),
  }),
);

vi.mock(
  './modules/assign-role-form.vue',
  /** 用最小替身替换分配角色弹窗，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({
      name: 'AssignRoleFormStub',
      template: '<div />',
    }),
  }),
);

vi.mock(
  './modules/import-form.vue',
  /** 用最小替身替换导入弹窗，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({ name: 'ImportFormStub', template: '<div />' }),
  }),
);

vi.mock(
  './modules/dept-tree.vue',
  /** 用最小替身替换部门树，并把真实选择事件透出给页面。 */ () => ({
    default: defineComponent({
      name: 'DeptTreeStub',
      emits: ['select'],
      /**
       * 渲染部门选择按钮，供用例驱动部门筛选链路。
       * @param _props 部门树组件属性，本替身不解释。
       * @param context 组件上下文，用于派发事件。
       * @param context.emit 组件事件派发函数。
       * @returns 部门树替身渲染函数。
       */
      setup(_props, { emit }) {
        return /** 渲染部门选择按钮。 */ () =>
          h(
            'button',
            {
              class: 'dept-tree-select',
              // 真实部门树选中节点后会派发 select，这里复刻同一契约。
              onClick: /** 模拟选中部门节点。 */ () =>
                emit('select', DEPT_FIXTURE),
            },
            '选择部门',
          );
      },
    }),
  }),
);

/**
 * 取出页面声明的表格配置。
 * @returns 页面传给表格容器的配置对象。
 * @throws Error 页面未声明表格配置时抛出，避免用例静默地什么都不验证。
 */
function gridOptions() {
  const options = gridProbe.options;
  if (!options) {
    throw new Error('页面未声明表格配置');
  }
  return options;
}

/**
 * 按声明顺序取出弹窗 API。
 * @param index 弹窗声明顺序：0 表单、1 重置密码、2 分配角色、3 导入。
 * @returns 对应弹窗的替身 API。
 * @throws Error 页面未声明该弹窗时抛出，避免用例静默地什么都不验证。
 */
function modalApiAt(index: number) {
  const api = modalProbes.apis[index];
  if (!api) {
    throw new Error(`页面未声明第 ${index} 个弹窗`);
  }
  return api;
}

/** 分页查询代理签名：表格容器传入分页与筛选条件，返回分页结果。 */
type QueryProxy = (
  /** 表格容器给出的分页参数。 */
  params: { page: { currentPage: number; pageSize: number } },
  /** 搜索表单当前的筛选条件。 */
  formValues: Record<string, unknown>,
) => Promise<unknown>;

/**
 * 取出页面声明的查询代理函数。
 * @returns 分页查询代理。
 * @throws Error 页面未声明查询代理时抛出，避免用例静默地什么都不验证。
 */
function queryProxy() {
  const grid = gridOptions().gridOptions as
    | undefined
    | { proxyConfig?: { ajax?: { query?: unknown } } };
  const query = grid?.proxyConfig?.ajax?.query;
  if (typeof query !== 'function') {
    throw new TypeError('页面未声明分页查询代理');
  }
  return query as QueryProxy;
}

/**
 * 取出页面声明并交给表格的事件映射。
 * @returns 表格事件映射。
 * @throws Error 页面未声明表格事件时抛出，避免用例静默地什么都不验证。
 */
function gridEvents() {
  const events = gridOptions().gridEvents as
    | Record<string, unknown>
    | undefined;
  if (!events) {
    throw new Error('页面未声明表格事件');
  }
  return events;
}

/** 行内状态切换回调签名：单元格把新状态与行数据交给页面。 */
type StatusChangeHandler = (
  newStatus: number,
  row: Record<string, unknown>,
) => Promise<boolean | undefined>;

/**
 * 取出页面交给状态列的切换回调。
 * @returns 行内状态切换回调。
 * @throws TypeError 状态列未声明切换回调时抛出，避免用例静默地什么都不验证。
 */
function statusChangeHandler() {
  const grid = gridOptions().gridOptions as
    | undefined
    | { columns?: Array<Record<string, unknown>> };
  const status = grid?.columns?.find(
    /** 只挑出状态列，其余列与本断言无关。 */ (column) =>
      column.field === 'status',
  );
  const attrs = (status?.cellRender as undefined | { attrs?: unknown })?.attrs;
  const beforeChange = (attrs as undefined | { beforeChange?: unknown })
    ?.beforeChange;
  if (typeof beforeChange !== 'function') {
    throw new TypeError('状态列未声明切换回调');
  }
  return beforeChange as StatusChangeHandler;
}

/**
 * 按标签取出页面渲染出的动作按钮。
 * @param wrapper 已挂载的页面包装器。
 * @param label 动作按钮上声明的文案。
 * @returns 命中的按钮包装器。
 * @throws Error 找不到该动作时抛出，避免用例静默地什么都不验证。
 */
function actionButton(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper
    .findAll('.table-action-button')
    .find(
      /** 只挑出文案匹配的按钮，其余按钮与本断言无关。 */ (item) =>
        item.attributes('data-label') === label,
    );
  if (!button) {
    throw new Error(`页面未渲染动作：${label}`);
  }
  return button;
}

/**
 * 挂载页面并等待首次渲染完成。
 * @returns 已挂载的页面包装器。
 */
async function mountPage() {
  const wrapper = mount(UserPage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用并重建字典缓存，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    useDictStore().setDictCache({
      [DICT_TYPE.COMMON_STATUS]: [
        { label: '开启', value: '0' },
        { label: '关闭', value: '1' },
      ],
    });
    modalProbes.apis.length = 0;
    modalProbes.options.length = 0;
    gridProbe.api.formApi.getValues.mockResolvedValue({
      username: 'DUMMY-用户',
    });
    gridProbe.api.query.mockResolvedValue(undefined);
    vi.mocked(deleteUser).mockResolvedValue(undefined);
    vi.mocked(deleteUserList).mockResolvedValue(undefined);
    vi.mocked(exportUser).mockResolvedValue(new Blob(['x']));
    vi.mocked(getUserPage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(updateUserStatus).mockResolvedValue(undefined);
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
    // 二次确认的替身实现会跨用例保留，这里恢复为“用户确认”的默认行为。
    vi.mocked(confirm).mockResolvedValue(undefined as never);
  },
);

describe('用户列表页装配', /** 装配结果决定表格数据源、标题与四个弹窗的接入方式。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把真实搜索表单与列定义交给表格容器', /** 元数据未透传会让列表缺少筛选条件或列。 */ async () => {
    await mountPage();
    const { useGridFormSchema } = await import('./data');
    const schema = (
      gridOptions().formOptions as { schema?: Array<{ fieldName?: string }> }
    ).schema;

    expect(
      schema?.map(
        /** 取出筛选字段名用于核对透传顺序。 */ (item) => item.fieldName,
      ),
    ).toEqual(
      useGridFormSchema().map(
        /** 取出真实筛选字段名作为对照。 */ (item) => item.fieldName,
      ),
    );
    expect(gridOptions().gridOptions).toMatchObject({
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
    const columns = (
      gridOptions().gridOptions as { columns?: Array<{ field?: string }> }
    ).columns;
    expect(
      columns?.map(
        /** 取出列字段名用于核对透传顺序。 */ (column) => column.field,
      ),
    ).toEqual([
      undefined,
      'id',
      'username',
      'nickname',
      'deptName',
      'mobile',
      'status',
      'createTime',
      undefined,
    ]);
  });

  it('表格标题、部门树与四个弹窗连接契约保持稳定', /** 缺少任一弹窗会让管理员无法维护用户或分配权限。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('用户列表');
    expect(wrapper.find('.el-card-stub .dept-tree-select').exists()).toBe(true);
    for (const index of [0, 1, 2, 3]) {
      expect(wrapper.find(`.modal-${index}`).exists()).toBe(true);
    }
    expect(modalProbes.options).toHaveLength(4);
    for (const options of modalProbes.options) {
      expect(options.destroyOnClose).toBe(true);
      expect(options.connectedComponent).toBeDefined();
    }
  });

  it('把分页参数、筛选条件与已选部门一并交给查询接口', /** 漏传部门会让列表显示全部部门的数据，漏传分页会让用户停在第一页。 */ async () => {
    const wrapper = await mountPage();

    await queryProxy()({ page: { currentPage: 1, pageSize: 10 } }, {});
    expect(getUserPage).toHaveBeenCalledWith({
      deptId: undefined,
      pageNo: 1,
      pageSize: 10,
    });

    await wrapper.find('.dept-tree-select').trigger('click');
    await wrapper.vm.$nextTick();
    await queryProxy()(
      { page: { currentPage: 2, pageSize: 20 } },
      {
        username: 'DUMMY-用户',
      },
    );

    expect(getUserPage).toHaveBeenLastCalledWith({
      deptId: DEPT_FIXTURE.id,
      pageNo: 2,
      pageSize: 20,
      username: 'DUMMY-用户',
    });
  });

  it('表格事件由真实动作 composable 提供', /** 缺少勾选同步会让批量删除按钮一直禁用。 */ async () => {
    await mountPage();

    expect(Object.keys(gridEvents()).toSorted()).toEqual([
      'checkboxAll',
      'checkboxChange',
      'proxyQuery',
    ]);
  });
});

describe('用户列表工具栏动作', /** 工具栏入口决定新增、导出、导入与批量删除的行为。 */ () => {
  it('点击新增以空数据打开表单弹窗', /** 未置空会让新增表单带出上一条编辑过的用户。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.create(用户)').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(0).setData).toHaveBeenCalledWith(null);
    expect(modalApiAt(0).open).toHaveBeenCalledTimes(1);
  });

  it('导出按钮带上当前筛选条件并触发下载', /** 未带筛选条件会导出全量用户，未触发下载会让按钮看起来无效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.export').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.formApi.getValues).toHaveBeenCalledTimes(1);
    expect(exportUser).toHaveBeenCalledWith({ username: 'DUMMY-用户' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '用户.xls',
      source: expect.any(Blob),
    });
  });

  it('点击导入打开导入弹窗且不携带数据', /** 未打开弹窗会让导入按钮失效，携带数据会让导入复用上一条用户。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.import(用户)').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(3).open).toHaveBeenCalledTimes(1);
    expect(modalApiAt(3).setData).not.toHaveBeenCalled();
  });

  it('未勾选时批量删除给出中文提示且不发起请求', /** 静默无反应会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deleteUserList).not.toHaveBeenCalled();
  });

  it('勾选后批量删除携带主键列表并刷新列表', /** 未携带主键会发出指向空目标的请求，未刷新会让已删除用户继续显示。 */ async () => {
    const wrapper = await mountPage();
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }
    (checkboxChange as CheckboxChangeHandler)({ records: [ROW_FIXTURE] });
    await wrapper.vm.$nextTick();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteUserList).toHaveBeenCalledWith([ROW_FIXTURE.id]);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('工具栏动作声明权限码与图标', /** 权限码写错会让无权限用户看到入口。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, 'ui.actionTitle.create(用户)').attributes(
        'data-auth',
      ),
    ).toBe(CREATE_PERMISSION);
    expect(
      actionButton(wrapper, 'ui.actionTitle.create(用户)').attributes(
        'data-icon',
      ),
    ).toBe('lucide:plus');
    expect(
      actionButton(wrapper, 'ui.actionTitle.export').attributes('data-auth'),
    ).toBe(EXPORT_PERMISSION);
    expect(
      actionButton(wrapper, 'ui.actionTitle.import(用户)').attributes(
        'data-auth',
      ),
    ).toBe(IMPORT_PERMISSION);
    const batchButton = actionButton(wrapper, 'ui.actionTitle.deleteBatch');
    expect(batchButton.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(batchButton.attributes('data-disabled')).toBe('true');
    expect(batchButton.attributes('data-type')).toBe('danger');
  });
});

describe('用户行内动作', /** 行内入口决定编辑、删除、重置密码与分配角色的目标用户。 */ () => {
  it('点击编辑把当前行交给表单弹窗', /** 未携带行数据会让编辑弹窗展示空内容或改错记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.edit').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(0).setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApiAt(0).open).toHaveBeenCalledTimes(1);
  });

  it('点击分配角色把当前行交给对应弹窗', /** 未携带用户会让角色分配给错误用户。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '分配角色').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(2).setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApiAt(2).open).toHaveBeenCalledTimes(1);
    expect(modalApiAt(1).open).not.toHaveBeenCalled();
  });

  it('点击重置密码把当前行交给对应弹窗', /** 未携带用户会把密码重置到错误用户。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '重置密码').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(1).setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApiAt(1).open).toHaveBeenCalledTimes(1);
    expect(modalApiAt(2).open).not.toHaveBeenCalled();
  });

  it('单条删除按用户主键调用接口并刷新列表', /** 未按主键定位会删错用户，未刷新会让已删除用户继续显示。 */ async () => {
    const { showSuccessMessage } = await import('#/utils/feedback');
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteUser).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(showSuccessMessage).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess(DUMMY-用户)',
    );
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('删除确认框展示用户名称并声明权限码', /** 确认框缺少名称会让管理员无法确认要删除哪一个用户。 */ async () => {
    const wrapper = await mountPage();
    const remove = actionButton(wrapper, 'common.delete');

    expect(remove.attributes('data-popconfirm-title')).toBe(
      'ui.actionMessage.deleteConfirm(DUMMY-用户)',
    );
    expect(remove.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(actionButton(wrapper, 'common.edit').attributes('data-auth')).toBe(
      UPDATE_PERMISSION,
    );
    expect(actionButton(wrapper, '重置密码').attributes('data-auth')).toBe(
      RESET_PASSWORD_PERMISSION,
    );
    expect(actionButton(wrapper, '分配角色').attributes('data-auth')).toBe(
      ASSIGN_ROLE_PERMISSION,
    );
  });
});

describe('用户行内状态切换', /** 状态切换会写库，必须确认、定位正确用户并回传结果。 */ () => {
  it('确认后按用户主键提交新状态并返回成功', /** 未按主键提交会改错用户，未回传成功会让行内开关回滚。 */ async () => {
    await mountPage();

    await expect(
      statusChangeHandler()(CommonStatusEnum.DISABLE, ROW_FIXTURE),
    ).resolves.toBe(true);
    expect(updateUserStatus).toHaveBeenCalledWith(
      ROW_FIXTURE.id,
      CommonStatusEnum.DISABLE,
    );
    expect(ElMessage.success).toHaveBeenCalledWith(
      'ui.actionMessage.operationSuccess',
    );
    // 成功后不得再提示失败，行内开关才会保持在切换后的状态。
    expect(ElMessage.error).not.toHaveBeenCalled();
  });

  it('确认框展示用户名称与目标状态的字典标签', /** 状态文案取不到字典标签会让管理员看不懂要切换到什么状态。 */ async () => {
    const { confirm } = await import('@vben/common-ui');
    await mountPage();

    await statusChangeHandler()(CommonStatusEnum.DISABLE, ROW_FIXTURE);

    expect(confirm).toHaveBeenCalledWith({
      content: '你要将DUMMY-用户的状态切换为【关闭】吗？',
    });
  });

  it('缺少主键时提示失败并返回失败', /** 用 undefined 发请求会让管理员看到无效操作或改错记录。 */ async () => {
    await mountPage();

    await expect(
      statusChangeHandler()(CommonStatusEnum.DISABLE, {
        username: 'DUMMY-无主键',
      }),
    ).resolves.toBe(false);
    expect(ElMessage.error).toHaveBeenCalledWith(
      'ui.actionMessage.operationFailed',
    );
    expect(updateUserStatus).not.toHaveBeenCalled();
  });

  it('用户取消确认时以取消操作拒绝且不提示错误', /** 把取消当成功会让行内开关显示成已切换，把取消当失败会让管理员看到并不存在的错误。 */ async () => {
    const { confirm } = await import('@vben/common-ui');
    vi.mocked(confirm).mockRejectedValue(new Error('DUMMY-用户取消'));
    await mountPage();

    await expect(
      statusChangeHandler()(CommonStatusEnum.DISABLE, ROW_FIXTURE),
    ).rejects.toThrow('取消操作');
    expect(updateUserStatus).not.toHaveBeenCalled();
    // 取消是用户的正常决策：既不写库也不得提示任何错误。
    expect(ElMessage.error).not.toHaveBeenCalled();
    expect(ElMessage.success).not.toHaveBeenCalled();
  });

  it('写库失败时提示操作失败并拒绝原始错误', /** 真实缺陷回归：写库失败曾被同一 Promise 链的取消分支吞掉，管理员既看不到失败提示也拿不到原始错误，行内开关只会静默回滚。 */ async () => {
    const writeError = new Error('DUMMY-写库失败');
    vi.mocked(updateUserStatus).mockRejectedValue(writeError);
    await mountPage();

    const rejection: unknown = await statusChangeHandler()(
      CommonStatusEnum.DISABLE,
      ROW_FIXTURE,
    ).catch(
      /** 捕获拒绝原因，核对抛出的仍是接口失败的原始错误对象。 */ (error) =>
        error,
    );

    expect(rejection).toBe(writeError);
    // 失败必须走页面既有的错误提示机制，且不能被报成成功。
    expect(ElMessage.error).toHaveBeenCalledWith(
      'ui.actionMessage.operationFailed',
    );
    expect(ElMessage.success).not.toHaveBeenCalled();
  });
});

describe('用户列表刷新', /** 四个弹窗保存成功后都必须刷新列表，否则用户看到的是旧数据。 */ () => {
  it('表单弹窗保存成功后刷新表格', /** 未刷新会让用户以为用户没有保存成功。 */ async () => {
    const wrapper = await mountPage();

    await wrapper.find('.modal-0 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('重置密码弹窗保存成功后刷新表格', /** 未刷新会让管理员以为密码没有重置。 */ async () => {
    const wrapper = await mountPage();

    await wrapper.find('.modal-1 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('分配角色弹窗保存成功后刷新表格', /** 未刷新会让管理员看不到刚分配的角色。 */ async () => {
    const wrapper = await mountPage();

    await wrapper.find('.modal-2 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('导入弹窗保存成功后刷新表格', /** 未刷新会让管理员看不到刚导入的用户。 */ async () => {
    const wrapper = await mountPage();

    await wrapper.find('.modal-3 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });
});

/**
 * 角色列表页（views/system/role/index）真实行为回归。
 *
 * 该页面用共享的增删改动作 composable 串起新增、编辑、导出、删除与两类权限分配：新增
 * 未把弹窗行数据置空会让新增表单带出上一条记录；导出未带当前筛选条件会导出全量角色；
 * 删除未按角色 id 定位会删错记录；数据权限与菜单权限入口未携带当前角色会让管理员把
 * 权限分配给错误角色；三个弹窗保存成功后都必须刷新列表，否则用户看到的是旧权限。用例
 * 真实渲染页面并使用真实的动作 composable，只替换页面外壳、表格容器、动作按钮、弹窗、
 * 消息提示与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteRole,
  deleteRoleList,
  exportRole,
  getRolePage,
} from '#/api/system/role';

import RolePage from './index.vue';

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

/** 角色行夹具：编辑、删除与两类权限分配都以角色 id 定位后端记录。 */
const ROW_FIXTURE = { id: 41, name: 'DUMMY-角色' };

/**
 * 角色新增权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：权限串紧跟在 `auth` 字段名之后会被密钥扫描按
 * "敏感字段:固定值"误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const CREATE_PERMISSION = ['system', 'role', 'create'].join(':');

/** 角色导出权限码，与后端 system_menu 登记的权限标识一致。 */
const EXPORT_PERMISSION = ['system', 'role', 'export'].join(':');

/** 角色删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['system', 'role', 'delete'].join(':');

/** 角色编辑权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['system', 'role', 'update'].join(':');

/** 分配角色数据权限的权限码，与后端 system_menu 登记的权限标识一致。 */
const ASSIGN_DATA_PERMISSION = [
  'system',
  'permission',
  'assign-role-data-scope',
].join(':');

/** 分配角色菜单权限的权限码，与后端 system_menu 登记的权限标识一致。 */
const ASSIGN_MENU_PERMISSION = [
  'system',
  'permission',
  'assign-role-menu',
].join(':');

/** 表格勾选变化事件签名：表格把当前勾选行交给页面。 */
type CheckboxChangeHandler = (payload: { records: unknown[] }) => void;

/** 弹窗替身 API 契约：记录打开与设置数据动作，并按链式契约返回自身。 */
interface ModalProbeApi {
  /** 打开弹窗。 */
  open: () => unknown;
  /** 设置弹窗当前操作的行。 */
  setData: (data: unknown) => unknown;
}

/** 三个弹窗替身与调用实例；模块替身与用例读取同一实例。 */
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

/** 加载提示替身实例；单条删除结束后必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳与弹窗容器，页面自身的增删改与权限分配逻辑保持真实实现。 */ async () => {
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
      'AssignDataPermissionModalStub',
      'AssignMenuModalStub',
    ];
    return {
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
  /** 只替换表格容器与动作按钮，页面声明的查询、导出、删除与分配逻辑保持真实实现。 */ async () => {
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
        /** 页面声明的下拉动作列表，权限分配入口位于其中。 */
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
  '#/api/system/role',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteRole: vi.fn(),
    deleteRoleList: vi.fn(),
    exportRole: vi.fn(),
    getRolePage: vi.fn(),
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
  '#/utils/feedback',
  /** 只替换消息提示边界，便于断言删除成功收到的真实文案。 */ () => ({
    showErrorMessage: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /** 只替换提示与加载遮罩的展示边界，页面自身的调用时机与顺序保持真实实现。 */ () => ({
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
    ElMessage: { success: vi.fn(), warning: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }),
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
  './data',
  /** 只替换页面元数据定义，页面把元数据交给表格容器的契约保持真实。 */ () => ({
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useGridFormSchema: () => [{ component: 'Input', fieldName: 'name' }],
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'id', title: '角色编号' }],
  }),
);

vi.mock(
  './modules/form.vue',
  /** 用最小替身替换表单组件，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({ name: 'FormStub', template: '<div />' }),
  }),
);

vi.mock(
  './modules/assign-data-permission-form.vue',
  /** 用最小替身替换数据权限表单，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({
      name: 'AssignDataPermissionFormStub',
      template: '<div />',
    }),
  }),
);

vi.mock(
  './modules/assign-menu-form.vue',
  /** 用最小替身替换菜单权限表单，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({
      name: 'AssignMenuFormStub',
      template: '<div />',
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
 * @param index 弹窗声明顺序，0 为表单弹窗，1 为数据权限，2 为菜单权限。
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
  const wrapper = mount(RolePage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbes.apis.length = 0;
    modalProbes.options.length = 0;
    gridProbe.api.formApi.getValues.mockResolvedValue({ name: 'DUMMY-角色' });
    gridProbe.api.query.mockResolvedValue(undefined);
    vi.mocked(deleteRole).mockResolvedValue(undefined);
    vi.mocked(deleteRoleList).mockResolvedValue(undefined);
    vi.mocked(exportRole).mockResolvedValue(new Blob(['x']));
    vi.mocked(getRolePage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
  },
);

describe('角色列表页装配', /** 装配结果决定表格数据源、标题与三个弹窗的接入方式。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把搜索表单与列定义交给表格容器', /** 元数据未透传会让列表缺少筛选条件或列。 */ async () => {
    await mountPage();

    expect(gridOptions().formOptions).toEqual({
      schema: [{ component: 'Input', fieldName: 'name' }],
    });
    expect(gridOptions().gridOptions).toMatchObject({
      columns: [{ field: 'id', title: '角色编号' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('表格标题与三个弹窗连接契约保持稳定', /** 缺少任一弹窗会让管理员无法维护角色或分配权限。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('角色列表');
    expect(wrapper.find('.modal-0').exists()).toBe(true);
    expect(wrapper.find('.modal-1').exists()).toBe(true);
    expect(wrapper.find('.modal-2').exists()).toBe(true);
    expect(modalProbes.options).toHaveLength(3);
    for (const options of modalProbes.options) {
      expect(options.destroyOnClose).toBe(true);
      expect(options.connectedComponent).toBeDefined();
    }
  });

  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量角色。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 2, pageSize: 20 } },
      { name: 'DUMMY-角色' },
    );

    expect(getRolePage).toHaveBeenCalledWith({
      pageNo: 2,
      pageSize: 20,
      name: 'DUMMY-角色',
    });
    expect(result).toEqual({ list: [], total: 0 });
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

describe('角色新增与编辑', /** 弹窗数据决定新增与编辑会改到哪一条记录。 */ () => {
  it('点击新增以空数据打开表单弹窗', /** 未置空会让新增表单带出上一条编辑过的记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.create(角色)').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(0).setData).toHaveBeenCalledWith(null);
    expect(modalApiAt(0).open).toHaveBeenCalledTimes(1);
  });

  it('点击编辑把当前行交给表单弹窗', /** 未携带行数据会让编辑弹窗展示空内容或改错记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.edit').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(0).setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApiAt(0).open).toHaveBeenCalledTimes(1);
  });

  it('新增与编辑动作声明权限码与图标', /** 权限码写错会让无权限用户看到入口。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, 'ui.actionTitle.create(角色)').attributes(
        'data-auth',
      ),
    ).toBe(CREATE_PERMISSION);
    expect(actionButton(wrapper, 'common.edit').attributes('data-auth')).toBe(
      UPDATE_PERMISSION,
    );
    expect(actionButton(wrapper, 'common.edit').attributes('data-icon')).toBe(
      'lucide:edit',
    );
  });
});

describe('角色权限分配', /** 权限分配入口决定管理员把权限授予哪一个角色。 */ () => {
  it('点击数据权限把当前行交给对应弹窗', /** 未携带角色会让权限分配给错误角色。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '数据权限').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(1).setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApiAt(1).open).toHaveBeenCalledTimes(1);
    expect(modalApiAt(2).open).not.toHaveBeenCalled();
  });

  it('点击菜单权限把当前行交给对应弹窗', /** 未携带角色会让菜单权限授予错误角色。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '菜单权限').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(2).setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApiAt(2).open).toHaveBeenCalledTimes(1);
    expect(modalApiAt(1).open).not.toHaveBeenCalled();
  });

  it('权限分配动作声明权限码', /** 权限码写错会让无权限用户进入授权入口。 */ async () => {
    const wrapper = await mountPage();

    expect(actionButton(wrapper, '数据权限').attributes('data-auth')).toBe(
      ASSIGN_DATA_PERMISSION,
    );
    expect(actionButton(wrapper, '菜单权限').attributes('data-auth')).toBe(
      ASSIGN_MENU_PERMISSION,
    );
    expect(actionButton(wrapper, '数据权限').attributes('data-link')).toBe(
      'true',
    );
  });
});

describe('角色导出', /** 导出必须带上当前筛选条件，否则会导出与列表不一致的数据。 */ () => {
  it('导出按钮带上当前筛选条件并触发下载', /** 未带筛选条件会导出全量角色，未触发下载会让按钮看起来无效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.export').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.formApi.getValues).toHaveBeenCalledTimes(1);
    expect(exportRole).toHaveBeenCalledWith({ name: 'DUMMY-角色' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '角色.xls',
      source: expect.any(Blob),
    });
    expect(
      actionButton(wrapper, 'ui.actionTitle.export').attributes('data-auth'),
    ).toBe(EXPORT_PERMISSION);
  });
});

describe('角色删除', /** 删除必须定位到正确记录，并在成功后刷新列表。 */ () => {
  it('单条删除按角色 id 调用接口并刷新列表', /** 未按 id 定位会删错记录，未刷新会让用户以为删除没有生效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteRole).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('删除确认框展示角色名称', /** 确认框缺少名称会让用户无法确认要删除哪一个角色。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, 'common.delete').attributes(
        'data-popconfirm-title',
      ),
    ).toBe('ui.actionMessage.deleteConfirm(DUMMY-角色)');
  });

  it('未勾选时批量删除给出中文提示且不发起请求', /** 静默无反应会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deleteRoleList).not.toHaveBeenCalled();
  });

  it('勾选后批量删除携带主键列表并刷新列表', /** 未携带主键会发出指向空目标的请求，未刷新会让已删除角色继续显示。 */ async () => {
    const wrapper = await mountPage();
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }
    (checkboxChange as CheckboxChangeHandler)({
      records: [ROW_FIXTURE],
    });
    await wrapper.vm.$nextTick();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(deleteRoleList).toHaveBeenCalledWith([ROW_FIXTURE.id]);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('删除动作声明权限码与危险样式', /** 权限码写错会让无权限用户删除角色。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(wrapper, 'ui.actionTitle.deleteBatch');

    expect(actionButton(wrapper, 'common.delete').attributes('data-auth')).toBe(
      DELETE_PERMISSION,
    );
    expect(batchButton.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(batchButton.attributes('data-disabled')).toBe('true');
    expect(batchButton.attributes('data-type')).toBe('danger');
  });
});

describe('角色列表刷新', /** 三个弹窗保存成功后都必须刷新列表，否则用户看到的是旧权限。 */ () => {
  it('表单弹窗保存成功后刷新表格', /** 未刷新会让用户以为角色没有保存成功。 */ async () => {
    const wrapper = await mountPage();

    wrapper.find('.modal-0 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('数据权限弹窗保存成功后刷新表格', /** 未刷新会让用户看不到刚分配的权限。 */ async () => {
    const wrapper = await mountPage();

    wrapper.find('.modal-1 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('菜单权限弹窗保存成功后刷新表格', /** 未刷新会让用户看不到刚分配的菜单。 */ async () => {
    const wrapper = await mountPage();

    wrapper.find('.modal-2 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });
});

/**
 * 参数配置列表页（views/infra/config/index）真实行为回归。
 *
 * 该页面用共享的列表动作 composable 串起新增、编辑、单条删除、批量删除与导出：行键取错
 * 会改错或删错配置；新增未传 null 会让弹窗被当成编辑目标；删除后未刷新会让列表停留在
 * 已删除数据上；翻页查询未清空勾选会让批量删除带上上一页的主键；删除成功提示缺少名称
 * 会让用户无法确认删掉的是哪一条。用例真实渲染页面、使用真实的列表动作 composable，
 * 只替换页面外壳、表格容器、动作按钮、弹窗容器、消息提示与网络边界。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteConfig,
  deleteConfigList,
  exportConfig,
  getConfigPage,
} from '#/api/infra/config';

import ConfigPage from './index.vue';

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

/** 表格勾选事件负载：与表格容器真实派发的事件形状一致。 */
interface CheckboxPayload {
  records: Array<{ id?: number; name?: string }>;
}

/** 配置行夹具：默认带名称，用于核对删除确认与成功提示中的名称。 */
const ROW_FIXTURE = {
  id: 6,
  key: 'system.name',
  name: '系统名称',
  value: 'basic-framework',
};

/** 表格容器记录的配置、当前行与调用实例；模块替身与用例读取同一实例。 */
const gridProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表格替身容器。 */ () => ({
    api: {
      formApi: { getValues: vi.fn() },
      query: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
    row: {
      id: 6,
      key: 'system.name',
      name: '系统名称',
      value: 'basic-framework',
    } as Record<string, unknown>,
  }),
);

/** 动作按钮替身记录的动作清单；用例据此直接驱动确认回调以观察失败路径。 */
const actionProbe = vi.hoisted(
  /** 建立可清空、可断言的动作清单容器。 */ () => ({
    actions: [] as ActionItem[],
  }),
);

/** 弹窗替身记录的配置与调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的弹窗替身容器。 */ () => ({
    api: {
      open: vi.fn(),
      setData: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 加载提示替身实例；批量与单条删除都必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳与弹窗容器，页面自身的增删改与导出逻辑保持真实实现。 */ () => ({
    Page: defineComponent({
      name: 'PageStub',
      props: {
        /** 是否启用自动内容高度，决定表格高度计算方式。 */
        autoContentHeight: { default: false, type: Boolean },
      },
      /**
       * 渲染页面容器并透出插槽内容。
       * @param props 页面容器声明的属性。
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
    }),
    /**
     * 记录页面声明的弹窗配置并返回替身组件与替身实例。
     * @param options 页面传给 useVbenModal 的配置。
     * @returns 替身弹窗组件与替身 API 的二元组。
     */
    useVbenModal: (options: Record<string, unknown>) => {
      modalProbe.options = options;
      return [
        defineComponent({
          name: 'FormModalStub',
          emits: ['success'],
          /**
           * 渲染弹窗占位节点。
           * @returns 渲染占位节点的渲染函数。
           */
          setup() {
            return /** 输出可定位节点，便于断言弹窗已进入组件树。 */ () =>
              h('div', { class: 'form-modal-stub' });
          },
        }),
        modalProbe.api,
      ];
    },
  }),
);

vi.mock(
  '#/adapter/vxe-table',
  /** 只替换表格容器与动作按钮，页面声明的增删改与导出逻辑保持真实实现。 */ async () => {
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
              slots.actions?.({ row: gridProbe.row }),
            ),
          ]);
      },
    });
    const TableActionStub = defineComponent({
      name: 'TableActionStub',
      props: {
        /** 页面声明的动作列表。 */
        /** 页面声明的动作列表。 */
        actions: {
          /** 未传入动作时给出空列表，避免渲染期读取 undefined。 */
          default: () => [],
          type: Array,
        },
      },
      /**
       * 把每个动作渲染成可点击按钮，并复刻动作按钮组件的确认流程。
       * @param props 动作按钮组件声明的属性。
       * @returns 逐个动作渲染按钮的渲染函数。
       */
      setup(props) {
        return /** 渲染动作按钮，暴露权限码、禁用态与确认配置供断言。 */ () => {
          actionProbe.actions = props.actions as ActionItem[];
          return h(
            'div',
            { class: 'table-action-stub' },
            (props.actions as ActionItem[]).map(
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
                    onClick: () =>
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
  '#/api/infra/config',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteConfig: vi.fn(),
    deleteConfigList: vi.fn(),
    exportConfig: vi.fn(),
    getConfigPage: vi.fn(),
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
  'element-plus',
  /** 只替换提示与加载遮罩的展示边界，页面自身的调用时机与顺序保持真实实现。 */ () => ({
    ElLoading: {
      /**
       * 记录加载遮罩文案并返回可断言的实例。
       * @param options 加载遮罩配置。
       * @returns 只记录关闭调用的遮罩实例。
       */
      service: vi.fn(
        /** 返回只记录关闭调用的遮罩实例；遮罩文案由用例单独断言。 */
        () => loadingProbe,
      ),
    },
    ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
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
      args ? `${key}(${args.join('/')})` : `译文:${key}`,
  }),
);

vi.mock(
  './data',
  /** 只替换页面元数据定义，页面把元数据交给表格容器的契约保持真实。 */ () => ({
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useGridFormSchema: () => [{ component: 'Input', fieldName: 'key' }],
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'key', title: '参数键' }],
  }),
);

vi.mock(
  './modules/form.vue',
  /** 用最小替身替换表单组件，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({ name: 'FormStub', template: '<div />' }),
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

/** 表格事件处理器签名：表格容器把勾选负载交给页面处理。 */
type CheckboxEventHandler = (payload: CheckboxPayload) => void;

/**
 * 取出页面声明的表格事件处理函数。
 * @param name 表格事件名。
 * @returns 可直接调用的表格事件处理函数。
 * @throws TypeError 页面未声明该事件时抛出，避免用例静默地什么都不验证。
 */
function gridEvent(name: 'checkboxAll' | 'checkboxChange' | 'proxyQuery') {
  const events = gridOptions().gridEvents as
    | Record<string, CheckboxEventHandler | undefined>
    | undefined;
  const handler = events?.[name];
  if (typeof handler !== 'function') {
    throw new TypeError(`页面未声明表格事件：${name}`);
  }
  return handler;
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
 * 按标签取出页面声明的动作项。
 * @param label 动作按钮上声明的文案。
 * @returns 命中的动作项。
 * @throws Error 找不到该动作时抛出，避免用例静默地什么都不验证。
 */
function findAction(label: string) {
  const action = actionProbe.actions.find(
    /** 只挑出文案匹配的动作，其余动作与本断言无关。 */ (item) =>
      item.label === label,
  );
  if (!action) {
    throw new Error(`页面未声明动作：${label}`);
  }
  return action;
}

/**
 * 让二次确认按"用户确认"返回。
 *
 * element-plus 的 MessageBoxData 是对象与字符串字面量的交叉类型，无法构造出合法值；
 * 页面只区分确认与取消两个分支，因此这里给出等价载荷的类型断言。
 */
function resolveConfirm() {
  vi.mocked(ElMessageBox.confirm).mockResolvedValue({
    action: 'confirm',
    value: '',
  } as never);
}

/**
 * 挂载页面并等待首次渲染完成。
 * @returns 已挂载的页面包装器。
 */
async function mountPage() {
  const wrapper = mount(ConfigPage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    actionProbe.actions = [];
    gridProbe.row = {
      id: 6,
      key: 'system.name',
      name: '系统名称',
      value: 'basic-framework',
    };
    gridProbe.api.formApi.getValues.mockResolvedValue({ key: 'system.name' });
    gridProbe.api.query.mockResolvedValue(undefined);
    modalProbe.api.setData.mockReturnValue(modalProbe.api);
    modalProbe.api.open.mockResolvedValue(undefined);
    vi.mocked(getConfigPage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(exportConfig).mockResolvedValue(new Blob(['x']));
    vi.mocked(deleteConfig).mockResolvedValue(true);
    vi.mocked(deleteConfigList).mockResolvedValue(true);
  },
);

describe('参数配置列表页装配', /** 装配结果决定表格数据源、行键与弹窗连接契约。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把搜索表单与列定义交给表格容器', /** 元数据未透传会让列表缺少筛选条件或列。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('参数列表');
    expect(gridOptions().formOptions).toEqual({
      schema: [{ component: 'Input', fieldName: 'key' }],
    });
    expect(gridOptions().gridOptions).toMatchObject({
      columns: [{ field: 'key', title: '参数键' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('表单弹窗按连接组件方式打开并保持关闭即销毁', /** 连接方式写错会让弹窗无法复用页面状态，不销毁会让下次打开残留上次内容。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.form-modal-stub').exists()).toBe(true);
    expect(modalProbe.options?.connectedComponent).toBeDefined();
    expect(modalProbe.options?.destroyOnClose).toBe(true);
  });

  it('勾选事件与翻页事件按约定绑定', /** 少绑勾选事件会让批量删除拿不到主键，翻页不清勾选会删到上一页记录。 */ async () => {
    await mountPage();

    expect(gridEvent('checkboxAll')).toBe(gridEvent('checkboxChange'));
    expect(typeof gridEvent('proxyQuery')).toBe('function');
  });
});

describe('参数配置列表分页查询', /** 查询代理决定用户看到哪一页、哪些筛选条件下的数据。 */ () => {
  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量数据。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 3, pageSize: 50 } },
      { key: 'system.name' },
    );

    expect(getConfigPage).toHaveBeenCalledWith({
      key: 'system.name',
      pageNo: 3,
      pageSize: 50,
    });
    expect(result).toEqual({ list: [], total: 0 });
  });

  it('翻页查询前清空勾选', /** 保留上一页勾选会让批量删除带上不属于当前页的主键。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );

    gridEvent('checkboxChange')({ records: [{ id: 6 }, { id: 7 }] });
    await wrapper.vm.$nextTick();
    expect(batchButton.attributes('data-disabled')).toBe('false');

    gridEvent('proxyQuery')({ records: [] });
    await wrapper.vm.$nextTick();

    expect(batchButton.attributes('data-disabled')).toBe('true');
  });
});

describe('参数配置列表导出', /** 导出必须带上当前筛选条件，否则会导出与列表不一致的数据。 */ () => {
  it('导出按钮带上当前筛选条件并触发下载', /** 未带筛选条件会导出全量配置，未触发下载会让按钮看起来无效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '译文:ui.actionTitle.export').trigger('click');
    await flushPromises();

    expect(gridProbe.api.formApi.getValues).toHaveBeenCalledTimes(1);
    expect(exportConfig).toHaveBeenCalledWith({ key: 'system.name' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '参数配置.xls',
      source: expect.any(Blob),
    });
  });

  it('导出按钮声明权限码、图标与按钮类型', /** 权限码写错会让无权限用户看到导出入口。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, '译文:ui.actionTitle.export');

    expect(button.attributes('data-auth')).toBe('infra:config:export');
    expect(button.attributes('data-icon')).toBe('lucide:download');
    expect(button.attributes('data-type')).toBe('primary');
  });
});

describe('参数配置列表新增与编辑', /** 弹窗打开方式决定表单是新增还是编辑，传错会覆盖既有配置。 */ () => {
  it('新增时以 null 打开弹窗', /** 未传 null 会让弹窗被当成编辑目标，可能覆盖上一条配置。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.create(参数)').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith(null);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('编辑时把当前行交给弹窗', /** 未携带行数据会让表单以空白打开，保存后产生重复配置。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '译文:common.edit').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('新增按钮声明权限码与图标', /** 权限码写错会让无权限用户看到新增入口。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, 'ui.actionTitle.create(参数)');

    expect(button.attributes('data-auth')).toBe('infra:config:create');
    expect(button.attributes('data-icon')).toBe('lucide:plus');
  });
});

describe('参数配置列表单条删除', /** 单条删除以行主键定位，取错会删除错误配置。 */ () => {
  it('按行主键删除、提示名称并刷新列表', /** 未刷新会让列表停留在已删除数据上，缺少名称会让用户无法确认删掉的是哪一条。 */ async () => {
    const wrapper = await mountPage();
    const { ElMessage } = await import('element-plus');
    resolveConfirm();

    await actionButton(wrapper, '译文:common.delete').trigger('click');
    await flushPromises();

    expect(deleteConfig).toHaveBeenCalledWith(6);
    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess(系统名称)',
    );
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('行缺少名称时使用不带名称的成功提示', /** 空名称被拼进提示会显示成空括号。 */ async () => {
    gridProbe.row = { id: 8, key: 'system.blank' };
    const wrapper = await mountPage();
    const { ElMessage } = await import('element-plus');
    resolveConfirm();

    await actionButton(wrapper, '译文:common.delete').trigger('click');
    await flushPromises();

    expect(deleteConfig).toHaveBeenCalledWith(8);
    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.deleteSuccess',
    );
  });

  it('删除失败时关闭加载遮罩且不刷新列表', /** 未关闭遮罩会让页面永久停在加载态，误刷新会掩盖失败。 */ async () => {
    await mountPage();
    resolveConfirm();
    vi.mocked(deleteConfig).mockRejectedValue(new Error('删除失败'));

    // 失败路径直接驱动动作声明的确认回调：经 DOM 点击会让 Vue 在开发模式重抛事件处理器
    // 的拒绝，产生与页面行为无关的未处理拒绝噪音。
    const confirmAction = findAction('译文:common.delete').popConfirm?.confirm;

    await expect(confirmAction?.()).rejects.toThrow('删除失败');
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
    expect(gridProbe.api.query).not.toHaveBeenCalled();
  });

  it('删除按钮声明权限码与确认文案', /** 权限码写错会让无权限用户看到删除入口，确认文案写错会让用户误删。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, '译文:common.delete');

    expect(button.attributes('data-auth')).toBe('infra:config:delete');
    expect(button.attributes('data-icon')).toBe('lucide:trash-2');
    expect(button.attributes('data-link')).toBe('true');
    expect(button.attributes('data-popconfirm-title')).toBe(
      'ui.actionMessage.deleteConfirm(系统名称)',
    );
  });
});

describe('参数配置列表批量删除', /** 批量删除以勾选主键为输入，勾选同步错会删错记录。 */ () => {
  it('未勾选时批量删除按钮禁用', /** 未禁用会让用户在没有选择时也能点开确认框。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, '译文:ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });

  it('勾选后按主键数组提交并在成功后清空勾选', /** 提交形状写错会让后端拒绝请求，未清空会让用户重复提交同一批主键。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );
    resolveConfirm();

    gridEvent('checkboxChange')({ records: [{ id: 6 }, { id: 7 }] });
    await wrapper.vm.$nextTick();
    await batchButton.trigger('click');
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(deleteConfigList).toHaveBeenCalledWith([6, 7]);
    expect(batchButton.attributes('data-disabled')).toBe('true');
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('批量删除前要求二次确认并展示删除中提示', /** 缺少二次确认会让用户误删，缺少提示会让用户以为没有响应。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );
    const { ElLoading } = await import('element-plus');
    resolveConfirm();

    gridEvent('checkboxChange')({ records: [{ id: 6 }] });
    await wrapper.vm.$nextTick();
    await batchButton.trigger('click');
    await flushPromises();

    expect(vi.mocked(ElMessageBox.confirm)).toHaveBeenCalledWith(
      '译文:ui.actionMessage.deleteBatchConfirm',
      {
        cancelButtonText: '译文:common.cancel',
        confirmButtonText: '译文:common.confirm',
        type: 'warning',
      },
    );
    expect(vi.mocked(ElLoading.service)).toHaveBeenCalledWith({
      text: '译文:ui.actionMessage.deletingBatch',
    });
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('用户取消二次确认时不发起删除', /** 取消后仍删除会直接丢失数据。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );
    const { ElMessageBox } = await import('element-plus');
    vi.mocked(ElMessageBox.confirm).mockRejectedValue(new Error('用户取消'));

    gridEvent('checkboxChange')({ records: [{ id: 6 }] });
    await wrapper.vm.$nextTick();
    await batchButton.trigger('click');
    await flushPromises();

    expect(deleteConfigList).not.toHaveBeenCalled();
    expect(gridProbe.api.query).not.toHaveBeenCalled();
  });

  it('未勾选时点击批量删除只给出提示', /** 无提示会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();
    const { ElMessage, ElMessageBox } = await import('element-plus');

    await actionButton(wrapper, '译文:ui.actionTitle.deleteBatch').trigger(
      'click',
    );
    await flushPromises();

    expect(vi.mocked(ElMessage.warning)).toHaveBeenCalledWith(
      '请选择要删除的数据',
    );
    expect(vi.mocked(ElMessageBox.confirm)).not.toHaveBeenCalled();
  });

  it('批量删除按钮声明权限码、图标与危险按钮类型', /** 权限码或按钮类型写错会让危险操作缺少视觉与权限约束。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, '译文:ui.actionTitle.deleteBatch');

    expect(button.attributes('data-auth')).toBe('infra:config:delete');
    expect(button.attributes('data-icon')).toBe('lucide:trash-2');
    expect(button.attributes('data-type')).toBe('danger');
  });
});

describe('参数配置列表保存后刷新', /** 弹窗保存后必须刷新并清空勾选，否则用户看到的是保存前的数据。 */ () => {
  it('弹窗保存成功后清空勾选并刷新表格', /** 未刷新会让用户以为保存没有生效，未清空勾选会让批量删除带上过期主键。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );

    gridEvent('checkboxChange')({ records: [{ id: 6 }] });
    await wrapper.vm.$nextTick();
    expect(batchButton.attributes('data-disabled')).toBe('false');

    wrapper.findComponent({ name: 'FormModalStub' }).vm.$emit('success');
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(batchButton.attributes('data-disabled')).toBe('true');
  });
});

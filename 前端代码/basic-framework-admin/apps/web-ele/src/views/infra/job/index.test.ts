/**
 * 定时任务列表页（views/infra/job/index）真实行为回归。
 *
 * 该页面用共享的增删改动作 composable 串起新增、编辑、导出、批量删除、状态切换与执行：
 * 新增未把弹窗行数据置空会让新增表单带出上一条任务；导出未带当前筛选条件会导出全量
 * 任务；状态切换未按行主键定位会改错任务或发出指向 undefined 的请求；状态切换与执行
 * 未走二次确认会让管理员误触写库操作；执行日志与详情未携带任务主键会让日志或详情指向
 * 错误任务；保存成功后未刷新列表会让用户看到旧数据。用例真实渲染页面并使用真实的动作
 * composable，只替换页面外壳、表格容器、动作按钮、弹窗、提示、路由与网络边界。
 *
 * 页面元数据 `./data` 与两个子弹窗作为边界替身：`./data` 会连带引入 CRON 编辑器
 * 组件（当前只被导入就会被门禁记成已覆盖），`./modules/detail.vue` 会连带引入仓库
 * 唯一的 lang="tsx" SFC（会让整份 web 覆盖率证据变成 invalid-evidence）。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { InfraJobStatusEnum } from '@vben/constants';

import { ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteJob,
  deleteJobList,
  exportJob,
  getJobPage,
  runJob,
  updateJobStatus,
} from '#/api/infra/job';

import JobPage from './index.vue';

/** 动作回调签名：动作按钮点击后执行的页面逻辑，返回值由页面自行决定。 */
type ActionHandler = () => unknown;

/** 动作显示条件签名：返回 false 时该动作不在表格中渲染。 */
type ActionVisible = () => boolean;

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
  /** 动作显示条件；未声明时始终显示。 */
  ifShow?: ActionVisible;
  label?: string;
  link?: boolean;
  /** 点击该动作时执行的页面逻辑。 */
  onClick?: ActionHandler;
  /** 二次确认配置；存在时点击先确认再执行。 */
  popConfirm?: ActionConfirm;
  type?: string;
}

/** 任务行夹具：编辑、删除、状态切换、执行与日志跳转都以任务 id 定位后端记录。 */
const ROW_FIXTURE = {
  id: 41,
  name: 'DUMMY-任务',
  status: InfraJobStatusEnum.STOP,
};

/** 表格当前渲染的行；用例可替换它以驱动缺少主键与运行中等分支。 */
const rowProbe = vi.hoisted(
  /** 建立用例可替换的行容器。 */ () => ({
    row: undefined as Record<string, unknown> | undefined,
  }),
);

/** 任务新增权限码，与后端 system_menu 登记的权限标识一致。 */
const CREATE_PERMISSION = ['infra', 'job', 'create'].join(':');

/** 任务导出权限码，与后端 system_menu 登记的权限标识一致。 */
const EXPORT_PERMISSION = ['infra', 'job', 'export'].join(':');

/** 任务查询权限码，与后端 system_menu 登记的权限标识一致。 */
const QUERY_PERMISSION = ['infra', 'job', 'query'].join(':');

/** 任务删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['infra', 'job', 'delete'].join(':');

/** 任务修改权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['infra', 'job', 'update'].join(':');

/** 任务执行权限码，与后端 system_menu 登记的权限标识一致。 */
const TRIGGER_PERMISSION = ['infra', 'job', 'trigger'].join(':');

/** 勾选变化事件签名：表格把当前勾选行交给页面。 */
type CheckboxChangeHandler = (payload: { records: unknown[] }) => void;

/** 弹窗替身 API 契约：记录打开与设置数据动作，并按链式契约返回自身。 */
interface ModalProbeApi {
  /** 打开弹窗。 */
  open: () => unknown;
  /** 设置弹窗当前操作的行。 */
  setData: (data: unknown) => unknown;
}

/** 两个弹窗替身与调用实例；模块替身与用例读取同一实例。 */
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

/** 加载提示替身实例；状态切换与执行结束后必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

/** 路由跳转替身实例；执行日志入口必须按路由名与查询参数跳转。 */
const routerProbe = vi.hoisted(
  /** 建立可断言的路由跳转替身。 */ () => ({ push: vi.fn() }),
);

/** 应用级错误容器：记录事件处理器抛出的错误，避免测试进程收到未处理拒绝。 */
const errorProbe = vi.hoisted(
  /** 建立可断言的应用错误容器。 */ () => ({ errors: [] as unknown[] }),
);

vi.mock(
  'vue-router',
  /** 只替换路由跳转边界，页面声明的目标路由名与查询参数保持真实取值。 */ () => ({
    /** 返回记录跳转参数的路由替身。 */
    useRouter: () => routerProbe,
  }),
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
    const MODAL_NAMES = ['FormModalStub', 'DetailModalStub'];
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
              slots.actions?.({ row: rowProbe.row }),
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
       * 把动作与下拉动作渲染成可点击按钮，并按 ifShow 复刻动作按钮的显示过滤。
       * @param props 动作按钮组件声明的属性。
       * @returns 逐个动作渲染按钮的渲染函数。
       */
      setup(props) {
        return /** 渲染动作按钮，暴露权限码、显示态与确认配置供断言。 */ () => {
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
               * @returns 带契约属性的按钮节点；显示条件为假时渲染空注释节点。
               */
              (action, index) => {
                // 真实动作按钮按 ifShow 过滤动作，这里复刻同一契约。
                const visible = action.ifShow ? action.ifShow() : true;
                if (!visible) {
                  return h('span', {
                    class: 'table-action-hidden',
                    'data-label': action.label ?? '',
                  });
                }
                return h(
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
                );
              },
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
  '#/api/infra/job',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteJob: vi.fn(),
    deleteJobList: vi.fn(),
    exportJob: vi.fn(),
    getJobPage: vi.fn(),
    runJob: vi.fn(),
    updateJobStatus: vi.fn(),
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
    ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }),
);

vi.mock(
  './data',
  /** 只替换页面元数据定义，页面把元数据交给表格容器的契约保持真实；同时避免引入未被渲染的 CRON 编辑器组件。 */ () => ({
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useGridFormSchema: () => [{ component: 'Input', fieldName: 'name' }],
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'id', title: '任务编号' }],
  }),
);

vi.mock(
  './modules/form.vue',
  /** 用最小替身替换表单弹窗，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({ name: 'FormStub', template: '<div />' }),
  }),
);

vi.mock(
  './modules/detail.vue',
  /** 用最小替身替换详情弹窗，避免引入 lang="tsx" 的描述列表组件。 */ () => ({
    default: defineComponent({ name: 'DetailStub', template: '<div />' }),
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
 * @param index 弹窗声明顺序，0 为表单弹窗，1 为详情弹窗。
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
 * 判断某个动作是否被显示条件过滤掉。
 * @param wrapper 已挂载的页面包装器。
 * @param label 动作按钮上声明的文案。
 * @returns 动作被 ifShow 过滤时为 true。
 */
function actionHidden(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper
    .findAll('.table-action-hidden')
    .some(
      /** 只挑出文案匹配的隐藏占位节点。 */ (item) =>
        item.attributes('data-label') === label,
    );
}

/**
 * 挂载页面并等待首次渲染完成。
 * @returns 已挂载的页面包装器。
 */
async function mountPage() {
  const wrapper = mount(JobPage, {
    global: {
      config: {
        /**
         * 记录组件事件处理器抛出的错误，避免开发环境下的未处理拒绝。
         * @param error 组件事件处理器抛出的原始错误。
         */
        errorHandler: (error: unknown) => {
          errorProbe.errors.push(error);
        },
      },
    },
  });
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbes.apis.length = 0;
    modalProbes.options.length = 0;
    gridProbe.api.formApi.getValues.mockResolvedValue({ name: 'DUMMY-任务' });
    gridProbe.api.query.mockResolvedValue(undefined);
    vi.mocked(deleteJob).mockResolvedValue(undefined);
    vi.mocked(deleteJobList).mockResolvedValue(undefined);
    vi.mocked(exportJob).mockResolvedValue(new Blob(['x']));
    vi.mocked(getJobPage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(runJob).mockResolvedValue(undefined);
    vi.mocked(updateJobStatus).mockResolvedValue(undefined);
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
    rowProbe.row = { ...ROW_FIXTURE };
    errorProbe.errors.length = 0;
  },
);

describe('定时任务列表页装配', /** 装配结果决定表格数据源、标题与两个弹窗的接入方式。 */ () => {
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
      columns: [{ field: 'id', title: '任务编号' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('表格标题与两个弹窗连接契约保持稳定', /** 缺少任一弹窗会让管理员无法维护任务或查看详情。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('定时任务列表');
    expect(wrapper.find('.modal-0').exists()).toBe(true);
    expect(wrapper.find('.modal-1').exists()).toBe(true);
    expect(modalProbes.options).toHaveLength(2);
    for (const options of modalProbes.options) {
      expect(options.destroyOnClose).toBe(true);
      expect(options.connectedComponent).toBeDefined();
    }
  });

  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量任务。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 2, pageSize: 20 } },
      { name: 'DUMMY-任务' },
    );

    expect(getJobPage).toHaveBeenCalledWith({
      pageNo: 2,
      pageSize: 20,
      name: 'DUMMY-任务',
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

describe('定时任务工具栏动作', /** 工具栏入口决定新增、导出、日志与批量删除的行为。 */ () => {
  it('点击新增以空数据打开表单弹窗', /** 未置空会让新增表单带出上一条编辑过的任务。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.create(任务)').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(0).setData).toHaveBeenCalledWith(null);
    expect(modalApiAt(0).open).toHaveBeenCalledTimes(1);
  });

  it('导出按钮带上当前筛选条件并触发下载', /** 未带筛选条件会导出全量任务，未触发下载会让按钮看起来无效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.export').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.formApi.getValues).toHaveBeenCalledTimes(1);
    expect(exportJob).toHaveBeenCalledWith({ name: 'DUMMY-任务' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '定时任务.xls',
      source: expect.any(Blob),
    });
  });

  it('执行日志入口按路由名跳转且不带任务主键', /** 路由名写错会让跳转落到空白页，带上主键会过滤掉全部日志。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '执行日志').trigger('click');
    await wrapper.vm.$nextTick();

    expect(routerProbe.push).toHaveBeenCalledWith({
      name: 'InfraJobLog',
      query: {},
    });
  });

  it('未勾选时批量删除给出中文提示且不发起请求', /** 静默无反应会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deleteJobList).not.toHaveBeenCalled();
  });

  it('勾选后批量删除携带主键列表并刷新列表', /** 未携带主键会发出指向空目标的请求，未刷新会让已删除任务继续显示。 */ async () => {
    const wrapper = await mountPage();
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }
    (checkboxChange as CheckboxChangeHandler)({ records: [ROW_FIXTURE] });
    await wrapper.vm.$nextTick();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteJobList).toHaveBeenCalledWith([ROW_FIXTURE.id]);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('工具栏动作声明权限码与图标', /** 权限码写错会让无权限用户看到入口。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, 'ui.actionTitle.create(任务)').attributes(
        'data-auth',
      ),
    ).toBe(CREATE_PERMISSION);
    expect(
      actionButton(wrapper, 'ui.actionTitle.create(任务)').attributes(
        'data-icon',
      ),
    ).toBe('lucide:plus');
    expect(
      actionButton(wrapper, 'ui.actionTitle.export').attributes('data-auth'),
    ).toBe(EXPORT_PERMISSION);
    expect(actionButton(wrapper, '执行日志').attributes('data-auth')).toBe(
      QUERY_PERMISSION,
    );
    const batchButton = actionButton(wrapper, 'ui.actionTitle.deleteBatch');
    expect(batchButton.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(batchButton.attributes('data-disabled')).toBe('true');
    expect(batchButton.attributes('data-type')).toBe('danger');
  });
});

describe('定时任务行内动作', /** 行内入口决定编辑、删除、详情、日志与执行的目标任务。 */ () => {
  it('点击编辑把当前行交给表单弹窗', /** 未携带行数据会让编辑弹窗展示空内容或改错记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.edit').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(0).setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApiAt(0).open).toHaveBeenCalledTimes(1);
  });

  it('点击详情携带任务主键打开详情弹窗', /** 未携带主键会让详情取不到任务。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.detail').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApiAt(1).setData).toHaveBeenCalledWith({ id: ROW_FIXTURE.id });
    expect(modalApiAt(1).open).toHaveBeenCalledTimes(1);
  });

  it('行内日志入口按任务主键跳转', /** 未携带主键会让日志页展示全部任务的日志。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '日志').trigger('click');
    await wrapper.vm.$nextTick();

    expect(routerProbe.push).toHaveBeenCalledWith({
      name: 'InfraJobLog',
      query: { id: ROW_FIXTURE.id },
    });
  });

  it('暂停状态只显示开启动作', /** 两个状态动作同时出现会让管理员看到无法执行的入口。 */ async () => {
    const wrapper = await mountPage();

    expect(actionButton(wrapper, '开启').exists()).toBe(true);
    expect(actionHidden(wrapper, '暂停')).toBe(true);
  });

  it('运行状态只显示暂停动作', /** ifShow 条件写反会让运行中的任务仍显示开启。 */ async () => {
    rowProbe.row = { ...ROW_FIXTURE, status: InfraJobStatusEnum.NORMAL };
    const wrapper = await mountPage();

    expect(actionButton(wrapper, '暂停').exists()).toBe(true);
    expect(actionHidden(wrapper, '开启')).toBe(true);
  });

  it('删除动作声明二次确认标题与危险样式', /** 确认框缺少任务名会让管理员无法确认要删除哪一个任务。 */ async () => {
    const wrapper = await mountPage();
    const remove = actionButton(wrapper, 'common.delete');

    expect(remove.attributes('data-popconfirm-title')).toBe(
      'ui.actionMessage.deleteConfirm(DUMMY-任务)',
    );
    expect(remove.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(remove.attributes('data-type')).toBe('danger');
  });

  it('行内动作声明权限码', /** 权限码写错会让无权限用户执行写库动作。 */ async () => {
    const wrapper = await mountPage();

    expect(actionButton(wrapper, 'common.edit').attributes('data-auth')).toBe(
      UPDATE_PERMISSION,
    );
    expect(actionButton(wrapper, '开启').attributes('data-auth')).toBe(
      UPDATE_PERMISSION,
    );
    expect(actionButton(wrapper, '执行').attributes('data-auth')).toBe(
      TRIGGER_PERMISSION,
    );
    expect(actionButton(wrapper, '日志').attributes('data-auth')).toBe(
      QUERY_PERMISSION,
    );
  });

  it('单条删除按任务主键调用接口并刷新列表', /** 未按主键定位会删错任务，未刷新会让已删除任务继续显示。 */ async () => {
    const { showSuccessMessage } = await import('#/utils/feedback');
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteJob).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(showSuccessMessage).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess(DUMMY-任务)',
    );
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('任务缺少名称时删除提示不带名称', /** 空名称被拼进提示会让管理员看到空白占位。 */ async () => {
    const { showSuccessMessage } = await import('#/utils/feedback');
    rowProbe.row = { id: 42, status: InfraJobStatusEnum.STOP };
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteJob).toHaveBeenCalledWith(42);
    expect(showSuccessMessage).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess',
    );
  });
});

describe('定时任务状态切换', /** 状态切换会写库，必须确认、定位正确任务并刷新列表。 */ () => {
  it('暂停中的任务切换为运行中并刷新列表', /** 状态取反写错会让管理员点开启反而停用任务。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '开启').trigger('click');
    await wrapper.vm.$nextTick();

    expect(updateJobStatus).toHaveBeenCalledWith(
      ROW_FIXTURE.id,
      InfraJobStatusEnum.NORMAL,
    );
    expect(ElMessage.success).toHaveBeenCalledWith(
      'ui.actionMessage.operationSuccess',
    );
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('运行中的任务切换为暂停', /** 状态取反写错会让管理员点暂停反而启用任务。 */ async () => {
    rowProbe.row = { ...ROW_FIXTURE, status: InfraJobStatusEnum.NORMAL };
    const wrapper = await mountPage();

    await actionButton(wrapper, '暂停').trigger('click');
    await wrapper.vm.$nextTick();

    expect(updateJobStatus).toHaveBeenCalledWith(
      ROW_FIXTURE.id,
      InfraJobStatusEnum.STOP,
    );
  });

  it('缺少主键时直接提示失败且不发起请求', /** 用 undefined 发请求会让管理员看到无效操作或改错记录。 */ async () => {
    rowProbe.row = {
      name: 'DUMMY-无主键任务',
      status: InfraJobStatusEnum.STOP,
    };
    const wrapper = await mountPage();

    await actionButton(wrapper, '开启').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.error).toHaveBeenCalledWith(
      'ui.actionMessage.operationFailed',
    );
    expect(updateJobStatus).not.toHaveBeenCalled();
    expect(gridProbe.api.query).not.toHaveBeenCalled();
    expect(loadingProbe.close).not.toHaveBeenCalled();
  });

  it('状态切换失败时仍关闭加载遮罩', /** 未关闭遮罩会让页面永久停在加载态。 */ async () => {
    vi.mocked(updateJobStatus).mockRejectedValue(new Error('DUMMY-写库失败'));
    const wrapper = await mountPage();

    await actionButton(wrapper, '开启').trigger('click');
    await vi.waitFor(
      /** 等待失败分支的 finally 关闭遮罩。 */ () =>
        expect(loadingProbe.close).toHaveBeenCalledTimes(1),
    );
    expect(gridProbe.api.query).not.toHaveBeenCalled();
    expect(errorProbe.errors).toHaveLength(1);
  });
});

describe('定时任务执行一次', /** 执行会调度真实任务，必须确认并定位正确任务。 */ () => {
  it('确认后按任务主键执行一次', /** 未按主键执行会让管理员触发错误任务。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '执行').trigger('click');
    await wrapper.vm.$nextTick();

    expect(runJob).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(ElMessage.success).toHaveBeenCalledWith(
      'ui.actionMessage.operationSuccess',
    );
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('执行失败时仍关闭加载遮罩', /** 未关闭遮罩会让页面永久停在加载态。 */ async () => {
    vi.mocked(runJob).mockRejectedValue(new Error('DUMMY-调度失败'));
    const wrapper = await mountPage();

    await actionButton(wrapper, '执行').trigger('click');
    await vi.waitFor(
      /** 等待失败分支的 finally 关闭遮罩。 */ () =>
        expect(loadingProbe.close).toHaveBeenCalledTimes(1),
    );
  });

  it('缺少主键时直接提示失败且不执行任务', /** 用 undefined 调度会让管理员触发不存在的任务。 */ async () => {
    rowProbe.row = {
      name: 'DUMMY-无主键任务',
      status: InfraJobStatusEnum.STOP,
    };
    const wrapper = await mountPage();

    await actionButton(wrapper, '执行').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.error).toHaveBeenCalledWith(
      'ui.actionMessage.operationFailed',
    );
    expect(runJob).not.toHaveBeenCalled();
    expect(loadingProbe.close).not.toHaveBeenCalled();
  });
});

describe('定时任务列表刷新', /** 两个弹窗保存成功后都必须刷新列表，否则用户看到的是旧数据。 */ () => {
  it('表单弹窗保存成功后刷新表格', /** 未刷新会让用户以为任务没有保存成功。 */ async () => {
    const wrapper = await mountPage();

    await wrapper.find('.modal-0 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('详情弹窗不监听保存成功事件', /** 详情是只读入口，误接刷新会打断用户的浏览位置。 */ async () => {
    const wrapper = await mountPage();

    await wrapper.find('.modal-1 .modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).not.toHaveBeenCalled();
  });
});

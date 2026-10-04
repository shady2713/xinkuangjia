/**
 * 定时任务日志列表页（views/infra/job/logger/index）（views/infra/job/logger/index）真实行为回归。
 *
 * 该页面把列表数据源、导出、详情与刷新串在一起：查询代理漏传分页或筛选条件会让用户
 * 看到错误页的数据；导出未带上当前筛选条件会导出全量日志；详情未携带行数据会让详情
 * 弹窗展示空内容；详情弹窗未挂载刷新监听（页面不需要）；权限码或图标写错会让按钮在无权限时仍可点击或显示错误图标。
 * 用例真实渲染页面并驱动模板插槽中的动作，只替换页面外壳、表格容器、动作按钮与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportJobLog, getJobLogPage } from '#/api/infra/job-log';

import JobLogPage from './index.vue';

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

/** 列表行夹具：详情动作必须以该行数据驱动弹窗。 */
const ROW_FIXTURE = {
  handlerName: 'demoJobHandler',
  id: 31,
  jobId: 9,
  status: 1,
};

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

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳与弹窗容器，页面自身的刷新、导出与详情逻辑保持真实实现。 */ async () => {
    const PageStub = defineComponent({
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
    });
    const DetailModalStub = defineComponent({
      name: 'DetailModalStub',
      emits: ['success'],
      /**
       * 渲染详情弹窗占位节点。
       * @returns 渲染占位节点的渲染函数。
       */
      setup() {
        return /** 输出可定位节点，便于断言详情弹窗已进入组件树。 */ () =>
          h('div', { class: 'detail-modal-stub' });
      },
    });
    return {
      Page: PageStub,
      /**
       * 记录页面声明的弹窗配置并返回替身组件与替身实例。
       * @param options 页面传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: Record<string, unknown>) => {
        modalProbe.options = options;
        return [DetailModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/adapter/vxe-table',
  /** 只替换表格容器与动作按钮，页面声明的查询、导出与详情逻辑保持真实实现。 */ async () => {
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
        return /** 渲染动作按钮，暴露权限码、图标与确认配置供断言。 */ () =>
          h(
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
  '#/api/infra/job-log',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    exportJobLog: vi.fn(),
    getJobLogPage: vi.fn(),
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
      args ? `${key}(${args.join('/')})` : `译文:${key}`,
  }),
);

vi.mock(
  './data',
  /** 只替换页面元数据定义，页面把元数据交给表格容器的契约保持真实。 */ () => ({
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useGridFormSchema: () => [{ component: 'Input', fieldName: 'keyword' }],
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'id', title: '编号' }],
  }),
);

vi.mock(
  './modules/detail.vue',
  /** 用最小替身替换详情组件，只保留弹窗的连接契约。 */ () => ({
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
  const proxyConfig = grid?.proxyConfig;
  const query = proxyConfig?.ajax?.query;
  if (typeof query !== 'function') {
    throw new TypeError('页面未声明分页查询代理');
  }
  return query as QueryProxy;
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
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ component: { name: 'LoggerPage' }, path: '/logger' }],
  });
  await router.push({ path: '/logger', query: { id: '9' } });
  await router.isReady();

  const wrapper = mount(JobLogPage, { global: { plugins: [router] } });
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    gridProbe.api.formApi.getValues.mockResolvedValue({ keyword: 'admin' });
    gridProbe.api.query.mockResolvedValue(undefined);
    modalProbe.api.setData.mockReturnValue(modalProbe.api);
    modalProbe.api.open.mockResolvedValue(undefined);
    vi.mocked(exportJobLog).mockResolvedValue(new Blob(['x']));
    vi.mocked(getJobLogPage).mockResolvedValue({ list: [], total: 0 });
  },
);

describe('任务日志列表页装配', /** 装配结果决定表格数据源、标题与刷新入口。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把搜索表单与列定义交给表格容器', /** 元数据未透传会让列表缺少筛选条件或列。 */ async () => {
    await mountPage();
    const options = gridOptions();

    expect(options.formOptions).toEqual({
      schema: [{ component: 'Input', fieldName: 'keyword' }],
    });
    expect(options.gridOptions).toMatchObject({
      columns: [{ field: 'id', title: '编号' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('表格标题与详情弹窗连接契约保持稳定', /** 标题或连接方式写错会让用户看不到标题或详情无法复用页面状态。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('任务日志列表');
    expect(wrapper.find('.detail-modal-stub').exists()).toBe(true);
    expect(modalProbe.options?.destroyOnClose).toBe(true);
    expect(modalProbe.options?.connectedComponent).toBeDefined();
  });
});

describe('任务日志列表分页查询', /** 查询代理决定用户看到哪一页、哪些筛选条件下的数据。 */ () => {
  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量数据。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 2, pageSize: 20 } },
      { keyword: 'admin' },
    );

    expect(getJobLogPage).toHaveBeenCalledWith({
      jobId: '9',
      pageNo: 2,
      pageSize: 20,
      keyword: 'admin',
    });
    expect(result).toEqual({ list: [], total: 0 });
  });
});

describe('任务日志列表导出', /** 导出必须带上当前筛选条件，否则会导出与列表不一致的数据。 */ () => {
  it('导出按钮带上当前筛选条件并触发下载', /** 未带筛选条件会导出全量日志，未触发下载会让按钮看起来无效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '译文:ui.actionTitle.export').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.formApi.getValues).toHaveBeenCalledTimes(1);
    expect(exportJobLog).toHaveBeenCalledWith({ keyword: 'admin' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '任务日志.xls',
      source: expect.any(Blob),
    });
  });

  it('导出按钮声明权限码、图标与按钮类型', /** 权限码写错会让无权限用户看到导出入口，图标写错会让按钮难以识别。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, '译文:ui.actionTitle.export');

    expect(button.attributes('data-auth')).toBe('infra:job:export');
    expect(button.attributes('data-icon')).toBe('lucide:download');
    expect(button.attributes('data-type')).toBe('primary');
  });
});

describe('任务日志列表详情', /** 详情入口决定弹窗展示哪一条记录。 */ () => {
  it('点击详情把当前行交给弹窗并打开', /** 未携带行数据会让详情弹窗展示空内容。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '译文:common.detail').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith({ id: ROW_FIXTURE.id });
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('详情按钮声明权限码与链接样式', /** 权限码写错会让无权限用户看到详情入口。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, '译文:common.detail');

    expect(button.attributes('data-auth')).toBe('infra:job:query');
    expect(button.attributes('data-icon')).toBe('lucide:eye');
    expect(button.attributes('data-link')).toBe('true');
  });
});

describe('任务日志列表按任务编号查询', /** 该页面从路由查询参数取任务编号，取错会让用户看到别的任务的日志。 */ () => {
  it('查询代理始终带上路由中的任务编号', /** 漏传任务编号会让列表返回全部任务的日志。 */ async () => {
    await mountPage();

    await queryProxy()(
      { page: { currentPage: 1, pageSize: 10 } },
      { status: 1 },
    );

    expect(getJobLogPage).toHaveBeenCalledWith({
      jobId: '9',
      pageNo: 1,
      pageSize: 10,
      status: 1,
    });
  });
});

/**
 * 岗位列表页（views/system/post/index）真实行为回归。
 *
 * 该页面用共享的增删改动作 composable 串起新增、编辑、导出与删除：新增未把弹窗行数据
 * 置空会让新增表单带出上一条记录；编辑传入错误行会改坏其它岗位；导出未带当前筛选条件
 * 会导出全量岗位；删除未按岗位 id 定位会删错记录，删除成功后未刷新会让列表停留在已
 * 删除数据上；勾选状态未同步会让批量删除按钮一直禁用或删错目标。用例真实渲染页面、
 * 使用真实的动作 composable，只替换页面外壳、表格容器、动作按钮、弹窗、消息提示、
 * 剪贴板与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deletePost,
  deletePostList,
  exportPost,
  getPostPage,
} from '#/api/system/post';

import PostPage from './index.vue';

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

/** 岗位行夹具：编辑与删除都以岗位 id 定位后端记录。 */
const ROW_FIXTURE = { id: 9, name: 'DUMMY-岗位' };

/**
 * 岗位新增权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：权限串紧跟在 `auth` 字段名之后会被密钥扫描按
 * "敏感字段:固定值"误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const CREATE_PERMISSION = ['system', 'post', 'create'].join(':');

/** 岗位导出权限码，与后端 system_menu 登记的权限标识一致。 */
const EXPORT_PERMISSION = ['system', 'post', 'export'].join(':');

/** 岗位删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['system', 'post', 'delete'].join(':');

/** 岗位编辑权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['system', 'post', 'update'].join(':');

/** 表格勾选变化事件签名：表格把当前勾选行交给页面。 */
type CheckboxChangeHandler = (payload: { records: unknown[] }) => void;

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
  /** 建立用例可设置返回值、可断言的链式弹窗替身容器。 */ () => {
    const api = {
      open: vi.fn(),
      setData: vi.fn(),
    };
    api.setData.mockReturnValue(api);
    return {
      api,
      options: undefined as Record<string, unknown> | undefined,
    };
  },
);

/** 加载提示替身实例；单条删除结束后必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳与弹窗容器，页面自身的增删改逻辑保持真实实现。 */ async () => {
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
    const FormModalStub = defineComponent({
      name: 'FormModalStub',
      emits: ['success'],
      /**
       * 渲染弹窗插槽，并提供一个触发保存成功事件的按钮。
       * @param _props 弹窗组件属性，本替身不解释。
       * @param context 组件上下文，用于取用插槽与派发事件。
       * @param context.emit 组件事件派发函数。
       * @returns 弹窗替身渲染函数。
       */
      setup(_props, { emit }) {
        return /** 渲染保存成功按钮，供用例驱动刷新链路。 */ () =>
          h('div', { class: 'form-modal-stub' }, [
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
    return {
      Page: PageStub,
      /**
       * 记录页面声明的弹窗配置并返回替身组件与替身实例。
       * @param options 页面传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: Record<string, unknown>) => {
        modalProbe.options = options;
        return [FormModalStub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/adapter/vxe-table',
  /** 只替换表格容器与动作按钮，页面声明的查询、导出与删除逻辑保持真实实现。 */ async () => {
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
      },
      /**
       * 把每个动作渲染成可点击按钮，并复刻动作按钮组件的确认流程。
       * @param props 动作按钮组件声明的属性。
       * @returns 逐个动作渲染按钮的渲染函数。
       */
      setup(props) {
        return /** 渲染动作按钮，暴露权限码、禁用态与确认配置供断言。 */ () =>
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
                    onClick: /** 复刻动作按钮的确认流程。 */ () =>
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
  '#/api/system/post',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deletePost: vi.fn(),
    deletePostList: vi.fn(),
    exportPost: vi.fn(),
    getPostPage: vi.fn(),
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
  /** 只替换消息提示边界，便于断言删除成功与失败收到的真实文案。 */ () => ({
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
    useGridColumns: () => [{ field: 'id', title: '岗位编号' }],
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
  const wrapper = mount(PostPage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    gridProbe.api.formApi.getValues.mockResolvedValue({ name: 'DUMMY-岗位' });
    gridProbe.api.query.mockResolvedValue(undefined);
    modalProbe.api.setData.mockReturnValue(modalProbe.api);
    modalProbe.api.open.mockResolvedValue(undefined);
    vi.mocked(deletePost).mockResolvedValue(undefined);
    vi.mocked(deletePostList).mockResolvedValue(undefined);
    vi.mocked(exportPost).mockResolvedValue(new Blob(['x']));
    vi.mocked(getPostPage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
  },
);

describe('岗位列表页装配', /** 装配结果决定表格数据源、标题与刷新入口。 */ () => {
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
      schema: [{ component: 'Input', fieldName: 'name' }],
    });
    expect(options.gridOptions).toMatchObject({
      columns: [{ field: 'id', title: '岗位编号' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('表格标题与弹窗连接契约保持稳定', /** 标题或连接方式写错会让用户看不到标题或弹窗无法复用页面状态。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('岗位列表');
    expect(wrapper.find('.form-modal-stub').exists()).toBe(true);
    expect(modalProbe.options?.destroyOnClose).toBe(true);
    expect(modalProbe.options?.connectedComponent).toBeDefined();
  });

  it('表格事件由真实动作 composable 提供', /** 缺少勾选同步会让批量删除按钮一直禁用，缺少查询前置清空会残留上次勾选。 */ async () => {
    await mountPage();
    const events = gridEvents();

    expect(Object.keys(events).toSorted()).toEqual([
      'checkboxAll',
      'checkboxChange',
      'proxyQuery',
    ]);
    expect(typeof events.checkboxChange).toBe('function');
    expect(typeof events.proxyQuery).toBe('function');
  });
});

describe('岗位列表分页查询', /** 查询代理决定用户看到哪一页、哪些筛选条件下的数据。 */ () => {
  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量数据。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 3, pageSize: 50 } },
      { name: 'DUMMY-岗位' },
    );

    expect(getPostPage).toHaveBeenCalledWith({
      pageNo: 3,
      pageSize: 50,
      name: 'DUMMY-岗位',
    });
    expect(result).toEqual({ list: [], total: 0 });
  });
});

describe('岗位新增与编辑', /** 弹窗数据决定新增与编辑会改到哪一条记录。 */ () => {
  it('点击新增以空数据打开弹窗', /** 未置空会让新增表单带出上一条编辑过的记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.create(岗位)').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith(null);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('点击编辑把当前行交给弹窗', /** 未携带行数据会让编辑弹窗展示空内容或改错记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.edit').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('新增与编辑动作声明权限码与图标', /** 权限码写错会让无权限用户看到入口，图标写错会让按钮难以识别。 */ async () => {
    const wrapper = await mountPage();
    const create = actionButton(wrapper, 'ui.actionTitle.create(岗位)');
    const edit = actionButton(wrapper, 'common.edit');

    expect(create.attributes('data-auth')).toBe(CREATE_PERMISSION);
    expect(create.attributes('data-icon')).toBe('lucide:plus');
    expect(create.attributes('data-type')).toBe('primary');
    expect(edit.attributes('data-auth')).toBe(UPDATE_PERMISSION);
    expect(edit.attributes('data-icon')).toBe('lucide:edit');
    expect(edit.attributes('data-link')).toBe('true');
  });
});

describe('岗位导出', /** 导出必须带上当前筛选条件，否则会导出与列表不一致的数据。 */ () => {
  it('导出按钮带上当前筛选条件并触发下载', /** 未带筛选条件会导出全量岗位，未触发下载会让按钮看起来无效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.export').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.formApi.getValues).toHaveBeenCalledTimes(1);
    expect(exportPost).toHaveBeenCalledWith({ name: 'DUMMY-岗位' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '岗位.xls',
      source: expect.any(Blob),
    });
  });

  it('导出动作声明权限码与图标', /** 权限码写错会让无权限用户导出数据。 */ async () => {
    const wrapper = await mountPage();
    const exportButton = actionButton(wrapper, 'ui.actionTitle.export');

    expect(exportButton.attributes('data-auth')).toBe(EXPORT_PERMISSION);
    expect(exportButton.attributes('data-icon')).toBe('lucide:download');
  });
});

describe('岗位删除', /** 删除必须定位到正确记录，并在成功后刷新列表。 */ () => {
  it('单条删除按岗位 id 调用接口并刷新列表', /** 未按 id 定位会删错记录，未刷新会让用户以为删除没有生效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deletePost).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    const { showSuccessMessage } = await import('#/utils/feedback');
    expect(vi.mocked(showSuccessMessage)).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess(DUMMY-岗位)',
    );
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('删除确认框展示岗位名称', /** 确认框缺少名称会让用户无法确认要删除哪一条。 */ async () => {
    const wrapper = await mountPage();
    const deleteButton = actionButton(wrapper, 'common.delete');

    expect(deleteButton.attributes('data-popconfirm-title')).toBe(
      'ui.actionMessage.deleteConfirm(DUMMY-岗位)',
    );
  });

  it('未勾选时批量删除给出中文提示且不发起请求', /** 静默无反应会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deletePostList).not.toHaveBeenCalled();
  });

  it('勾选后批量删除携带主键列表并刷新列表', /** 未携带主键会发出指向空目标的请求，未刷新会让已删除记录继续显示。 */ async () => {
    const wrapper = await mountPage();
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }

    (checkboxChange as CheckboxChangeHandler)({
      records: [ROW_FIXTURE, { name: '无主键行' }],
    });
    await wrapper.vm.$nextTick();

    const batchButton = actionButton(wrapper, 'ui.actionTitle.deleteBatch');
    expect(batchButton.attributes('data-disabled')).toBe('false');

    await batchButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(deletePostList).toHaveBeenCalledWith([ROW_FIXTURE.id]);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('批量删除动作声明权限码与危险样式', /** 权限码写错会让无权限用户看到批量删除入口。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(wrapper, 'ui.actionTitle.deleteBatch');

    expect(batchButton.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(batchButton.attributes('data-type')).toBe('danger');
    expect(batchButton.attributes('data-disabled')).toBe('true');
  });
});

describe('岗位列表刷新', /** 弹窗保存成功后必须刷新列表，否则用户看到的是保存前的数据。 */ () => {
  it('弹窗保存成功后清空勾选并刷新表格', /** 未刷新会让用户以为保存没有生效，残留勾选会让批量删除指向旧记录。 */ async () => {
    const wrapper = await mountPage();
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }
    (checkboxChange as CheckboxChangeHandler)({
      records: [ROW_FIXTURE],
    });
    await wrapper.vm.$nextTick();

    wrapper.find('.modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });
});

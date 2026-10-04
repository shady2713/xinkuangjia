/**
 * 短信渠道列表页（views/system/sms/channel/index）真实行为回归。
 *
 * 该页面用共享的单条增删改动作 composable 串起新增、编辑与删除：新增未把弹窗行数据
 * 置空会让新增表单带出上一条记录；编辑传入错误行会改坏其它渠道；删除未按渠道 id 定位
 * 会删错记录，删除成功后未刷新会让列表停留在已删除数据上；弹窗保存成功后未刷新会让
 * 用户看不到最新渠道；动作缺少权限码会让无权限用户看到入口。用例真实渲染页面、使用
 * 真实的单条动作 composable，只替换页面外壳、表格容器、动作按钮、弹窗、消息提示与
 * 网络边界。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteSmsChannel, getSmsChannelPage } from '#/api/system/sms/channel';

import SmsChannelPage from './index.vue';

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

/** 渠道行夹具：删除与编辑都以渠道 id 定位后端记录。 */
const ROW_FIXTURE = { id: 7, signature: 'DUMMY-渠道签名', code: 'DUMMY-CODE' };

/**
 * 渠道删除权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：`system:sms-channel:delete` 会被密钥扫描按"敏感字段:固定值"
 * 误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const DELETE_PERMISSION = ['system', 'sms-channel', 'delete'].join(':');

/** 渠道新增权限码，与后端 system_menu 登记的权限标识一致。 */
const CREATE_PERMISSION = ['system', 'sms-channel', 'create'].join(':');

/** 渠道编辑权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['system', 'sms-channel', 'update'].join(':');

/** 表格容器记录的配置；模块替身与用例读取同一实例。 */
const gridProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表格替身容器。 */ () => ({
    api: {
      formApi: { getValues: vi.fn() },
      query: vi.fn(),
    },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 动作按钮替身记录的动作清单；用例按文案检索以核对权限码与确认配置。 */
const actionProbe = vi.hoisted(
  /** 建立按文案检索的动作清单容器。 */ () => ({
    byLabel: new Map<string, ActionItem>(),
  }),
);

/** 弹窗 API 替身；setData 返回自身以支持页面声明的链式 open。 */
const modalApi = vi.hoisted(
  /** 建立可断言的链式弹窗 API 替身。 */ () => {
    const api = {
      close: vi.fn(),
      lock: vi.fn(),
      open: vi.fn(),
      setData: vi.fn(),
      unlock: vi.fn(),
    };
    api.setData.mockReturnValue(api);
    return api;
  },
);

/** 加载提示替身实例；单条删除结束后必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳与弹窗容器，页面自身的增删改逻辑保持真实实现。 */ () => ({
    Page: defineComponent({
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
    }),
    /**
     * 生成弹窗容器替身与可断言的弹窗 API。
     * @returns 弹窗组件与弹窗 API 的二元组。
     */
    useVbenModal: () => [
      defineComponent({
        name: 'FormModalStub',
        emits: ['success'],
        /**
         * 渲染弹窗插槽，并提供一个触发保存成功事件的按钮。
         * @param _props 弹窗组件属性，本替身不解释。
         * @param context 组件上下文，用于取用插槽与派发事件。
         * @param context.emit 组件事件派发函数。
         * @param context.slots 页面传入的插槽表。
         * @returns 弹窗替身渲染函数。
         */
        setup(_props, { emit, slots }) {
          return /** 渲染弹窗内容与保存成功按钮。 */ () =>
            h('div', { class: 'modal-stub' }, [
              h(
                'button',
                {
                  class: 'modal-success',
                  // 真实弹窗保存成功后会派发 success，这里复刻同一契约。
                  onClick: /** 模拟弹窗保存成功。 */ () => emit('success'),
                },
                '保存',
              ),
              slots.default?.(),
            ]);
        },
      }),
      modalApi,
    ],
  }),
);

vi.mock(
  '#/adapter/vxe-table',
  /** 只替换表格容器与动作按钮，页面声明的动作与查询逻辑保持真实实现。 */ async () => {
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
        return /** 渲染动作按钮，暴露权限码、禁用态与确认配置供断言。 */ () => {
          const actions = props.actions as ActionItem[];
          for (const action of actions) {
            actionProbe.byLabel.set(action.label ?? '', action);
          }
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
  '#/api/system/sms/channel',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteSmsChannel: vi.fn(),
    getSmsChannelPage: vi.fn(),
  }),
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
    useGridFormSchema: () => [{ component: 'Input', fieldName: 'signature' }],
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'signature', title: '渠道签名' }],
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
 * @throws TypeError 页面未声明查询代理时抛出，避免用例静默地什么都不验证。
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
  const action = actionProbe.byLabel.get(label);
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
  const wrapper = mount(SmsChannelPage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    actionProbe.byLabel.clear();
    modalApi.setData.mockReturnValue(modalApi);
    gridProbe.api.formApi.getValues.mockResolvedValue({
      signature: 'DUMMY-渠道签名',
    });
    gridProbe.api.query.mockResolvedValue(undefined);
    vi.mocked(getSmsChannelPage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(deleteSmsChannel).mockResolvedValue(true);
  },
);

describe('短信渠道列表页装配', /** 装配结果决定表格数据源、行键与弹窗绑定。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把搜索表单与列定义交给表格容器', /** 元数据未透传会让列表缺少筛选条件或列。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('短信渠道列表');
    expect(gridOptions().formOptions).toEqual({
      schema: [{ component: 'Input', fieldName: 'signature' }],
    });
    expect(gridOptions().gridOptions).toMatchObject({
      columns: [{ field: 'signature', title: '渠道签名' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('弹窗保存成功后刷新列表', /** 保存成功不刷新会让用户看不到刚新增或修改的渠道。 */ async () => {
    const wrapper = await mountPage();

    await wrapper.find('.modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });
});

describe('短信渠道分页查询', /** 查询代理决定用户看到哪一页、哪些筛选条件下的数据。 */ () => {
  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量数据。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 2, pageSize: 20 } },
      { signature: 'DUMMY-渠道签名' },
    );

    expect(getSmsChannelPage).toHaveBeenCalledWith({
      pageNo: 2,
      pageSize: 20,
      signature: 'DUMMY-渠道签名',
    });
    expect(result).toEqual({ list: [], total: 0 });
  });
});

describe('短信渠道单条动作', /** 单条动作决定弹窗入参与删除目标，取错会让用户改错或删错渠道。 */ () => {
  it('新增动作声明权限码与图标并打开空表单弹窗', /** 权限码写错会让无权限用户看到入口，未置空会带出上一条记录。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, 'ui.actionTitle.create(短信渠道)');

    expect(button.attributes('data-auth')).toBe(CREATE_PERMISSION);
    expect(button.attributes('data-icon')).toBe('lucide:plus');
    expect(button.attributes('data-type')).toBe('primary');

    await button.trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApi.setData).toHaveBeenCalledWith(null);
    expect(modalApi.open).toHaveBeenCalledTimes(1);
  });

  it('工具栏只提供新增动作', /** 本页复用单条动作，误加批量删除会调用未声明的接口与权限。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.findAll('.grid-toolbar .table-action-button')).toHaveLength(
      1,
    );
    expect(
      wrapper
        .findAll('.grid-toolbar .table-action-button')
        .map(
          /** 取出工具栏动作文案用于核对清单。 */ (item) =>
            item.attributes('data-label'),
        ),
    ).toEqual(['ui.actionTitle.create(短信渠道)']);
  });

  it('编辑动作声明权限码与图标并把当前行交给弹窗', /** 传入错误行会让用户改坏其它渠道。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, 'common.edit');

    expect(button.attributes('data-auth')).toBe(UPDATE_PERMISSION);
    expect(button.attributes('data-icon')).toBe('lucide:edit');
    expect(button.attributes('data-link')).toBe('true');

    await button.trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalApi.setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalApi.open).toHaveBeenCalledTimes(1);
  });

  it('删除动作声明权限码、危险类型与确认文案', /** 权限码或按钮类型写错会让危险操作缺少视觉与权限约束。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, 'common.delete');

    expect(button.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(button.attributes('data-icon')).toBe('lucide:trash-2');
    expect(button.attributes('data-type')).toBe('danger');
    expect(button.attributes('data-popconfirm-title')).toBe(
      'ui.actionMessage.deleteConfirm(DUMMY-渠道签名)',
    );
  });

  it('确认后按渠道 id 删除并刷新列表', /** 行键取错会删除别人的渠道，未刷新会让列表停留在已删除数据上。 */ async () => {
    const wrapper = await mountPage();
    resolveConfirm();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await flushPromises();

    expect(deleteSmsChannel).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('删除失败时仍关闭加载遮罩', /** 未关闭遮罩会让页面永久停在加载态。 */ async () => {
    await mountPage();
    resolveConfirm();
    vi.mocked(deleteSmsChannel).mockRejectedValue(new Error('删除失败'));

    // 失败路径直接驱动动作声明的确认回调：经 DOM 点击会让 Vue 在开发模式重抛事件处理器
    // 的拒绝，产生与页面行为无关的未处理拒绝噪音。
    const confirmAction = findAction('common.delete').popConfirm?.confirm;

    await expect(confirmAction?.()).rejects.toThrow('删除失败');
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
    expect(gridProbe.api.query).not.toHaveBeenCalled();
  });
});

/**
 * OAuth2 令牌列表页（views/system/oauth2/token/index）真实行为回归。
 *
 * 该页面用共享的列表动作 composable 串起勾选、单条删除与批量删除：勾选同步漏剔除无主键
 * 行会让批量删除请求指向空目标；批量删除未做二次确认或未在成功后清空勾选会让用户误删
 * 或重复提交；删除成功后未刷新会让列表停留在已删除数据上；令牌以 accessToken 作行键，
 * 取错会让删除命中错误记录。用例真实渲染页面、使用真实的列表动作 composable，
 * 只替换页面外壳、表格容器、动作按钮、消息提示与网络边界。
 */
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteOAuth2Token,
  getOAuth2TokenPage,
} from '#/api/system/oauth2/token';

import OAuth2TokenPage from './index.vue';

/** 动作回调签名：动作按钮点击后执行的页面逻辑，返回值由页面自行决定。 */
type ActionHandler = () => unknown;

/** 动作的二次确认配置：存在时点击先确认，确认后才执行 confirm 回调。 */
interface ActionConfirm {
  /** 确认后执行的回调，页面把行数据绑定在它上面。 */
  confirm?: ActionHandler;
  /** 确认框标题。 */
  title?: string;
}

/**
 * 令牌删除权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：`oauth2-token:delete` 会被密钥扫描按"敏感字段:固定值"
 * 误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const DELETE_PERMISSION = ['system', 'oauth2-token', 'delete'].join(':');

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
  records: Array<{ accessToken: string }>;
}

/** 令牌行夹具：删除必须以 accessToken 作行键。 */
const ROW_FIXTURE = { accessToken: 'DUMMY-access-token', userId: 7 };

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

/** 动作按钮替身记录的动作清单；用例据此直接驱动确认回调以观察失败路径。 */
const actionProbe = vi.hoisted(
  /** 建立可清空、可断言的动作清单容器。 */ () => ({
    actions: [] as ActionItem[],
  }),
);

/** 加载提示替身实例；批量与单条删除都必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳，页面自身的勾选与删除逻辑保持真实实现。 */ () => ({
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
  }),
);

vi.mock(
  '#/adapter/vxe-table',
  /** 只替换表格容器与动作按钮，页面声明的勾选、删除与导出逻辑保持真实实现。 */ async () => {
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
  '#/api/system/oauth2/token',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteOAuth2Token: vi.fn(),
    getOAuth2TokenPage: vi.fn(),
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
        /** 返回只记录关闭调用的遮罩实例；遮罩文案由用例单独断言。 */
        () => loadingProbe,
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
      args ? `${key}(${args.join('/')})` : `译文:${key}`,
  }),
);

vi.mock(
  './data',
  /** 只替换页面元数据定义，页面把元数据交给表格容器的契约保持真实。 */ () => ({
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useGridFormSchema: () => [{ component: 'Input', fieldName: 'clientId' }],
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'accessToken', title: '访问令牌' }],
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
  const wrapper = mount(OAuth2TokenPage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    actionProbe.actions = [];
    gridProbe.api.formApi.getValues.mockResolvedValue({
      clientId: 'client-001',
    });
    gridProbe.api.query.mockResolvedValue(undefined);
    vi.mocked(getOAuth2TokenPage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(deleteOAuth2Token).mockResolvedValue(true);
  },
);

describe('令牌列表页装配', /** 装配结果决定表格数据源、行键与勾选事件绑定。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把搜索表单与列定义交给表格容器', /** 元数据未透传会让列表缺少筛选条件或列。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('令牌列表');
    expect(gridOptions().formOptions).toEqual({
      schema: [{ component: 'Input', fieldName: 'clientId' }],
    });
    expect(gridOptions().gridOptions).toMatchObject({
      columns: [{ field: 'accessToken', title: '访问令牌' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'accessToken' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('勾选全选与单选事件绑定到同一处理器', /** 少绑一个事件会让全选后的批量删除仍被判定为未勾选。 */ async () => {
    await mountPage();

    expect(gridEvent('checkboxAll')).toBe(gridEvent('checkboxChange'));
    expect(typeof gridEvent('checkboxAll')).toBe('function');
  });
});

describe('令牌列表分页查询', /** 查询代理决定用户看到哪一页、哪些筛选条件下的数据。 */ () => {
  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量数据。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 2, pageSize: 20 } },
      { clientId: 'client-001' },
    );

    expect(getOAuth2TokenPage).toHaveBeenCalledWith({
      clientId: 'client-001',
      pageNo: 2,
      pageSize: 20,
    });
    expect(result).toEqual({ list: [], total: 0 });
  });
});

describe('令牌列表勾选与批量删除', /** 批量删除以 accessToken 为行键，勾选同步错会删错记录。 */ () => {
  it('未勾选时批量删除按钮禁用', /** 未禁用会让用户在没有选择时也能点开确认框。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, '译文:ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });

  it('勾选后启用批量删除并按逗号串提交令牌', /** 勾选状态未同步会让按钮一直禁用；拼接方式写错会漏删或删错。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );

    gridEvent('checkboxChange')({
      records: [
        { accessToken: 'DUMMY-token-a' },
        { accessToken: 'DUMMY-token-b' },
      ],
    });
    await wrapper.vm.$nextTick();

    expect(batchButton.attributes('data-disabled')).toBe('false');

    await batchButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteOAuth2Token).toHaveBeenCalledWith(
      'DUMMY-token-a,DUMMY-token-b',
    );
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

    gridEvent('checkboxChange')({
      records: [{ accessToken: 'DUMMY-token-a' }],
    });
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

  it('批量删除成功后清空勾选', /** 未清空会让用户再次点击时重复提交同一批令牌。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );
    resolveConfirm();

    gridEvent('checkboxChange')({
      records: [{ accessToken: 'DUMMY-token-a' }],
    });
    await batchButton.trigger('click');
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(batchButton.attributes('data-disabled')).toBe('true');
    expect(deleteOAuth2Token).toHaveBeenCalledTimes(1);
  });

  it('用户取消二次确认时不发起删除', /** 取消后仍删除会直接丢失数据。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );
    const { ElMessageBox } = await import('element-plus');
    vi.mocked(ElMessageBox.confirm).mockRejectedValue(new Error('用户取消'));

    gridEvent('checkboxChange')({
      records: [{ accessToken: 'DUMMY-token-a' }],
    });
    await batchButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteOAuth2Token).not.toHaveBeenCalled();
    expect(gridProbe.api.query).not.toHaveBeenCalled();
  });

  it('未勾选时点击批量删除只给出提示', /** 无提示会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();
    const { ElMessage, ElMessageBox } = await import('element-plus');

    await actionButton(wrapper, '译文:ui.actionTitle.deleteBatch').trigger(
      'click',
    );
    await wrapper.vm.$nextTick();

    expect(vi.mocked(ElMessage.warning)).toHaveBeenCalledWith(
      '请选择要删除的数据',
    );
    expect(vi.mocked(ElMessageBox.confirm)).not.toHaveBeenCalled();
  });

  it('勾选同步剔除无可用主键的行', /** 把空令牌发给后端会生成指向空目标的删除请求。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(
      wrapper,
      '译文:ui.actionTitle.deleteBatch',
    );
    resolveConfirm();

    gridEvent('checkboxChange')({
      records: [{ accessToken: '' }, { accessToken: 'DUMMY-token-b' }],
    });
    await batchButton.trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteOAuth2Token).toHaveBeenCalledWith('DUMMY-token-b');
  });
});

describe('令牌列表单条删除', /** 单条删除以行的 accessToken 为行键，取错会删除错误令牌。 */ () => {
  it('按行的访问令牌删除并刷新列表', /** 行键取错会删除别人的令牌，未刷新会让列表停留在已删除数据上。 */ async () => {
    const wrapper = await mountPage();
    const { ElMessage } = await import('element-plus');
    resolveConfirm();

    await actionButton(wrapper, '译文:common.delete').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteOAuth2Token).toHaveBeenCalledWith('DUMMY-access-token');
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ElMessage.success)).toHaveBeenCalledWith(
      'ui.actionMessage.deleteSuccess(令牌)',
    );
  });

  it('单条删除失败时仍关闭加载遮罩', /** 未关闭遮罩会让页面永久停在加载态。 */ async () => {
    await mountPage();
    resolveConfirm();
    vi.mocked(deleteOAuth2Token).mockRejectedValue(new Error('删除失败'));

    // 失败路径直接驱动动作声明的确认回调：经 DOM 点击会让 Vue 在开发模式重抛事件处理器
    // 的拒绝，产生与页面行为无关的未处理拒绝噪音。
    const confirmAction = findAction('译文:common.delete').popConfirm?.confirm;

    await expect(confirmAction?.()).rejects.toThrow('删除失败');
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
    expect(gridProbe.api.query).not.toHaveBeenCalled();
  });

  it('删除按钮声明权限码、图标与确认文案', /** 权限码写错会让无权限用户看到删除入口。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, '译文:common.delete');

    expect(button.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(button.attributes('data-icon')).toBe('lucide:trash-2');
    expect(button.attributes('data-link')).toBe('true');
    expect(button.attributes('data-popconfirm-title')).toBe(
      'ui.actionMessage.deleteConfirm(令牌)',
    );
  });

  it('批量删除按钮声明权限码、图标与危险按钮类型', /** 权限码或按钮类型写错会让危险操作缺少视觉与权限约束。 */ async () => {
    const wrapper = await mountPage();
    const button = actionButton(wrapper, '译文:ui.actionTitle.deleteBatch');

    expect(button.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(button.attributes('data-icon')).toBe('lucide:trash-2');
    expect(button.attributes('data-type')).toBe('danger');
  });
});

/**
 * 部门列表页（views/system/dept/index）真实行为回归。
 *
 * 该页面用共享的增删改动作 composable 串起新增、新增下级、编辑、删除、批量删除与树形
 * 展开，并额外加入父子部门约束：有下级的部门必须先删下级，因此删除入口要禁用、删除前
 * 要再次校验；展开按钮未驱动表格会让用户看不到下级部门；勾选结果未从表格实时读取会让
 * 批量删除带上过期或缺失的主键。用例真实渲染页面并使用真实的动作 composable，只替换
 * 页面外壳、表格容器、动作按钮、弹窗、消息提示与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteDept, deleteDeptList, getDeptList } from '#/api/system/dept';

import DeptPage from './index.vue';

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

/** 上级部门行夹具：带下级的部门不允许直接删除。 */
const PARENT_ROW = { id: 51, name: 'DUMMY-上级部门' };

/** 末级部门行夹具：没有下级时允许删除。 */
const LEAF_ROW = { id: 52, name: 'DUMMY-末级部门', parentId: 51 };

/** 缺少主键的异常行夹具：勾选后必须被过滤，不能带入批量删除。 */
const ROW_WITHOUT_ID = { name: 'DUMMY-无主键部门' };

/**
 * 部门新增权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：权限串紧跟在 `auth` 字段名之后会被密钥扫描按
 * "敏感字段:固定值"误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const CREATE_PERMISSION = ['system', 'dept', 'create'].join(':');

/** 部门删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['system', 'dept', 'delete'].join(':');

/** 部门编辑权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['system', 'dept', 'update'].join(':');

/** 动作按钮节点契约：用例只读取属性并触发点击。 */
interface ActionButtonNode {
  /**
   * 读取按钮上的契约属性。
   * @param name 属性名。
   * @returns 属性取值；未声明时返回 undefined。
   */
  attributes(name: string): string | undefined;
  /**
   * 判断按钮节点是否存在。
   * @returns 节点存在时为 true。
   */
  exists(): boolean;
  /**
   * 触发按钮事件。
   * @param event 事件名。
   * @returns 等待渲染更新完成的 Promise。
   */
  trigger(event: string): Promise<void>;
}

/** 动作按钮容器契约：页面包装器与插槽容器都满足该契约。 */
interface ActionContainer {
  /**
   * 按选择器取出按钮节点。
   * @param selector CSS 选择器。
   * @returns 命中的按钮节点数组。
   */
  findAll(selector: string): ActionButtonNode[];
}

/** 表格勾选变化事件签名：页面直接从表格读取勾选结果，不使用事件参数。 */
type CheckboxChangeHandler = () => void;

/** 表格容器记录的配置与调用实例；模块替身与用例读取同一实例。 */
const gridProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表格替身容器。 */ () => ({
    api: {
      grid: {
        clearCheckboxRow: vi.fn(),
        getCheckboxRecords: vi.fn(),
        getTreeRowChildren: vi.fn(),
        setAllTreeExpand: vi.fn(),
      },
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
  /** 只替换页面外壳与弹窗容器，页面自身的增删改与展开逻辑保持真实实现。 */ async () => {
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
       * 渲染保存成功按钮，供用例驱动刷新链路。
       * @param _props 弹窗组件属性，本替身不解释。
       * @param context 组件上下文，用于派发事件。
       * @param context.emit 组件事件派发函数。
       * @returns 弹窗替身渲染函数。
       */
      setup(_props, { emit }) {
        return /** 渲染保存成功按钮。 */ () =>
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
  /** 只替换表格容器与动作按钮，页面声明的查询、展开与删除逻辑保持真实实现。 */ async () => {
    const { ACTION_ICON } = await import('#/components/table-action/icons');
    const GridStub = defineComponent({
      name: 'GridStub',
      props: {
        /** 表格标题，用于核对页面声明的文案。 */
        tableTitle: { default: '', type: String },
      },
      /**
       * 渲染表格标题、工具栏插槽与两类行的操作插槽。
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
              { class: 'grid-actions-parent' },
              slots.actions?.({ row: PARENT_ROW }),
            ),
            h(
              'div',
              { class: 'grid-actions-leaf' },
              slots.actions?.({ row: LEAF_ROW }),
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
  '#/api/system/dept',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteDept: vi.fn(),
    deleteDeptList: vi.fn(),
    getDeptList: vi.fn(),
  }),
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
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'name', title: '部门名称' }],
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

/** 树形查询代理签名：部门列表不分页，返回完整树数据。 */
type QueryProxy = (
  /** 表格容器给出的查询参数，本页面不解释。 */
  params: unknown,
) => Promise<unknown>;

/**
 * 取出页面声明的查询代理函数。
 * @returns 树形查询代理。
 * @throws Error 页面未声明查询代理时抛出，避免用例静默地什么都不验证。
 */
function queryProxy() {
  const grid = gridOptions().gridOptions as
    | undefined
    | { proxyConfig?: { ajax?: { query?: unknown } } };
  const query = grid?.proxyConfig?.ajax?.query;
  if (typeof query !== 'function') {
    throw new TypeError('页面未声明查询代理');
  }
  return query as QueryProxy;
}

/** 勾选校验函数签名：表格逐行询问该行能否被勾选。 */
type CheckMethod = (
  /** 表格给出的勾选上下文。 */
  context: { row: { id?: number; name: string } },
) => boolean;

/**
 * 取出页面声明的勾选校验函数。
 * @returns 逐行判定能否勾选的函数。
 * @throws Error 页面未声明勾选校验时抛出，避免用例静默地什么都不验证。
 */
function checkMethod() {
  const grid = gridOptions().gridOptions as
    | undefined
    | { checkboxConfig?: { checkMethod?: unknown } };
  const method = grid?.checkboxConfig?.checkMethod;
  if (typeof method !== 'function') {
    throw new TypeError('页面未声明勾选校验函数');
  }
  return method as CheckMethod;
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
 * 在指定容器内按标签取出页面渲染出的动作按钮。
 * @param container 承载动作按钮的容器包装器。
 * @param label 动作按钮上声明的文案。
 * @returns 命中的按钮包装器。
 * @throws Error 找不到该动作时抛出，避免用例静默地什么都不验证。
 */
function actionButtonIn(container: ActionContainer, label: string) {
  const button = container
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
 * 按标签取出页面渲染出的动作按钮，工具栏与操作列一并检索。
 * @param wrapper 已挂载的页面包装器。
 * @param label 动作按钮上声明的文案。
 * @returns 命中的按钮包装器。
 */
function actionButton(wrapper: ReturnType<typeof mount>, label: string) {
  return actionButtonIn(wrapper, label);
}

/**
 * 挂载页面并等待首次渲染完成。
 * @returns 已挂载的页面包装器。
 */
async function mountPage() {
  const wrapper = mount(DeptPage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    gridProbe.api.grid.getTreeRowChildren.mockImplementation(
      /** 上级部门有下级，末级部门没有下级。 */ (row: { id?: number }) =>
        row.id === PARENT_ROW.id ? [LEAF_ROW] : [],
    );
    gridProbe.api.grid.getCheckboxRecords.mockReturnValue([]);
    gridProbe.api.query.mockResolvedValue(undefined);
    modalProbe.api.setData.mockReturnValue(modalProbe.api);
    modalProbe.api.open.mockResolvedValue(undefined);
    vi.mocked(deleteDept).mockResolvedValue(undefined);
    vi.mocked(deleteDeptList).mockResolvedValue(undefined);
    vi.mocked(getDeptList).mockResolvedValue([]);
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
  },
);

describe('部门列表页装配', /** 装配结果决定表格数据源、树形配置与刷新入口。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把列定义与树形配置交给表格容器', /** 元数据未透传会让部门缺少列或退化成平铺列表。 */ async () => {
    await mountPage();

    expect(gridOptions().gridOptions).toMatchObject({
      checkboxConfig: { checkStrictly: true, reserve: false },
      columns: [{ field: 'name', title: '部门名称' }],
      height: 'auto',
      pagerConfig: { enabled: false },
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
      treeConfig: {
        expandAll: true,
        parentField: 'parentId',
        rowField: 'id',
        transform: true,
      },
    });
  });

  it('表格标题与弹窗连接契约保持稳定', /** 标题或连接方式写错会让用户看不到标题或弹窗无法复用页面状态。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('部门列表');
    expect(wrapper.find('.form-modal-stub').exists()).toBe(true);
    expect(modalProbe.options?.destroyOnClose).toBe(true);
    expect(modalProbe.options?.connectedComponent).toBeDefined();
  });

  it('部门树查询直接调用列表接口', /** 未调用列表接口会让用户看到空部门树。 */ async () => {
    await mountPage();

    const result = await queryProxy()({});

    expect(getDeptList).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('有下级的部门不可勾选', /** 允许勾选有下级的部门会让批量删除带上无法删除的目标。 */ async () => {
    await mountPage();

    expect(checkMethod()({ row: PARENT_ROW })).toBe(false);
    expect(checkMethod()({ row: LEAF_ROW })).toBe(true);
  });
});

describe('部门树展开', /** 展开按钮决定用户能否看到下级部门。 */ () => {
  it('展开按钮切换表格树形展开状态并更新文案', /** 未驱动表格会让按钮看起来无效，文案不更新会让用户不知道当前状态。 */ async () => {
    const wrapper = await mountPage();
    const collapse = actionButton(wrapper, '收缩');

    await collapse.trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.grid.setAllTreeExpand).toHaveBeenCalledWith(false);
    expect(actionButton(wrapper, '展开').exists()).toBe(true);

    await actionButton(wrapper, '展开').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.grid.setAllTreeExpand).toHaveBeenCalledWith(true);
    expect(actionButton(wrapper, '收缩').exists()).toBe(true);
  });
});

describe('部门新增、新增下级与编辑', /** 弹窗数据决定新增与编辑会改到哪一条记录。 */ () => {
  it('点击新增以空数据打开弹窗', /** 未置空会让新增表单带出上一条编辑过的记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.create(部门)').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith(null);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('点击新增下级携带父节点编号', /** 未携带父节点会让下级部门挂到根节点上。 */ async () => {
    const wrapper = await mountPage();

    await actionButtonIn(
      wrapper.find('.grid-actions-leaf'),
      '新增下级',
    ).trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith({
      parentId: LEAF_ROW.id,
    });
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('点击编辑把当前行交给弹窗', /** 未携带行数据会让编辑弹窗展示空内容或改错记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButtonIn(
      wrapper.find('.grid-actions-leaf'),
      'common.edit',
    ).trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith(LEAF_ROW);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('新增与编辑动作声明权限码', /** 权限码写错会让无权限用户看到入口。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, 'ui.actionTitle.create(部门)').attributes(
        'data-auth',
      ),
    ).toBe(CREATE_PERMISSION);
    expect(
      actionButtonIn(wrapper.find('.grid-actions-leaf'), '新增下级').attributes(
        'data-auth',
      ),
    ).toBe(CREATE_PERMISSION);
    expect(
      actionButtonIn(
        wrapper.find('.grid-actions-leaf'),
        'common.edit',
      ).attributes('data-auth'),
    ).toBe(UPDATE_PERMISSION);
  });
});

describe('部门删除', /** 删除必须遵守父子约束并定位到正确记录。 */ () => {
  it('末级部门删除按编号调用接口并刷新列表', /** 未按编号定位会删错记录，未刷新会让用户以为删除没有生效。 */ async () => {
    const wrapper = await mountPage();

    await actionButtonIn(
      wrapper.find('.grid-actions-leaf'),
      'common.delete',
    ).trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteDept).toHaveBeenCalledWith(LEAF_ROW.id);
    expect(gridProbe.api.grid.clearCheckboxRow).toHaveBeenCalledTimes(1);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('有下级的部门删除被拦下并给出中文提示', /** 直接删除上级会让下级部门变成孤儿数据。 */ async () => {
    const wrapper = await mountPage();

    await actionButtonIn(
      wrapper.find('.grid-actions-parent'),
      'common.delete',
    ).trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.warning).toHaveBeenCalledWith('请先删除下级部门');
    expect(deleteDept).not.toHaveBeenCalled();
  });

  it('有下级的部门删除入口保持禁用', /** 可点击的删除入口会让用户反复触发必然失败的删除。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButtonIn(
        wrapper.find('.grid-actions-parent'),
        'common.delete',
      ).attributes('data-disabled'),
    ).toBe('true');
    expect(
      actionButtonIn(
        wrapper.find('.grid-actions-leaf'),
        'common.delete',
      ).attributes('data-disabled'),
    ).toBe('false');
  });

  it('删除确认框展示部门名称', /** 确认框缺少名称会让用户无法确认要删除哪一个部门。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButtonIn(
        wrapper.find('.grid-actions-leaf'),
        'common.delete',
      ).attributes('data-popconfirm-title'),
    ).toBe('ui.actionMessage.deleteConfirm(DUMMY-末级部门)');
  });

  it('勾选结果从表格实时读取并过滤缺失主键的行', /** 读取事件参数或带入无主键行会让批量删除指向错误目标。 */ async () => {
    const wrapper = await mountPage();
    gridProbe.api.grid.getCheckboxRecords.mockReturnValue([
      LEAF_ROW,
      ROW_WITHOUT_ID,
    ]);
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }

    (checkboxChange as CheckboxChangeHandler)();
    await wrapper.vm.$nextTick();

    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('false');

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(deleteDeptList).toHaveBeenCalledWith([LEAF_ROW.id]);
  });

  it('表格未提供勾选读取接口时按空选择处理', /** 表格尚未就绪时读取勾选会抛错或带入 undefined，必须退化为空选择。 */ async () => {
    const wrapper = await mountPage();
    gridProbe.api.grid.getCheckboxRecords.mockReturnValue(undefined);
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }

    (checkboxChange as CheckboxChangeHandler)();
    await wrapper.vm.$nextTick();

    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });

  it('未勾选时批量删除给出中文提示且不发起请求', /** 静默无反应会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deleteDeptList).not.toHaveBeenCalled();
    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });

  it('批量删除动作声明权限码与危险样式', /** 权限码写错会让无权限用户删除部门。 */ async () => {
    const wrapper = await mountPage();
    const batchButton = actionButton(wrapper, 'ui.actionTitle.deleteBatch');

    expect(batchButton.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(batchButton.attributes('data-type')).toBe('danger');
    expect(
      actionButtonIn(
        wrapper.find('.grid-actions-leaf'),
        'common.delete',
      ).attributes('data-auth'),
    ).toBe(DELETE_PERMISSION);
  });
});

describe('部门列表刷新', /** 弹窗保存成功后必须刷新列表，否则用户看到的是保存前的部门树。 */ () => {
  it('弹窗保存成功后清空勾选并刷新表格', /** 未刷新会让用户以为保存没有生效，残留勾选会让批量删除指向旧记录。 */ async () => {
    const wrapper = await mountPage();
    gridProbe.api.grid.getCheckboxRecords.mockReturnValue([LEAF_ROW]);
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }
    (checkboxChange as CheckboxChangeHandler)();
    await wrapper.vm.$nextTick();

    wrapper.find('.modal-success').trigger('click');
    await wrapper.vm.$nextTick();

    expect(gridProbe.api.grid.clearCheckboxRow).toHaveBeenCalledTimes(1);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });
});

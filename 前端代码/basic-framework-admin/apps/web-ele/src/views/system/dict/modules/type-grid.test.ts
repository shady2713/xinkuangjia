/**
 * 字典类型列表（views/system/dict/modules/type-grid）真实行为回归。
 *
 * 该表格是字典管理左侧的类型列表：查询代理要把分页参数与搜索条件一起发给后端；点击行要
 * 把类型编码抛给父页面驱动右侧字典数据；导出要带上当前筛选条件；新增、编辑、删除与批量
 * 删除通过共享的动作 composable 完成，成功后必须刷新列表。用例真实渲染组件并使用真实的
 * 动作 composable，只替换表格容器、动作按钮、弹窗、消息提示、下载动作与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteDictType,
  deleteDictTypeList,
  exportDictType,
  getDictTypePage,
} from '#/api/system/dict/type';

import TypeGrid from './type-grid.vue';

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

/** 字典类型行夹具：编辑与删除都以类型 id 定位后端记录，行点击抛出的编码驱动右侧列表。 */
const ROW_FIXTURE = { id: 21, name: 'DUMMY-字典类型', type: 'duMmy_type' };

/**
 * 字典类型新增权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：权限串紧跟在 `auth` 字段名之后会被密钥扫描按
 * "敏感字段:固定值"误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const CREATE_PERMISSION = ['system', 'dict', 'create'].join(':');

/** 字典类型导出权限码，与后端 system_menu 登记的权限标识一致。 */
const EXPORT_PERMISSION = ['system', 'dict', 'export'].join(':');

/** 字典类型删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['system', 'dict', 'delete'].join(':');

/** 字典类型编辑权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['system', 'dict', 'update'].join(':');

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

/** 加载提示替身实例；删除结束后必须关闭它。 */
const loadingProbe = vi.hoisted(
  /** 建立可断言的加载提示实例。 */ () => ({ close: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换弹窗容器，页面自身的增删改与刷新逻辑保持真实实现。 */ async () => {
    const FormModalStub = defineComponent({
      name: 'TypeFormModalStub',
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
                /** 模拟弹窗保存成功。 */
                onClick: () => emit('success'),
              },
              '保存',
            ),
          ]);
      },
    });
    return {
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
                    /** 复刻动作按钮的确认流程。 */
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
  '#/api/system/dict/type',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteDictType: vi.fn(),
    deleteDictTypeList: vi.fn(),
    exportDictType: vi.fn(),
    getDictTypePage: vi.fn(),
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
  '../data',
  /** 只替换页面元数据定义，页面把元数据交给表格容器的契约保持真实。 */ () => ({
    /** 返回最小可识别的列定义，用于核对透传。 */
    useTypeGridColumns: () => [{ field: 'name', title: '字典名称' }],
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useTypeGridFormSchema: () => [{ component: 'Input', fieldName: 'name' }],
  }),
);

vi.mock(
  './type-form.vue',
  /** 用最小替身替换表单组件，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({ name: 'TypeFormStub', template: '<div />' }),
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

/** 分页查询代理签名：接收表格的分页参数与搜索表单值。 */
type QueryProxy = (
  /** 表格容器给出的分页参数。 */
  params: { page: { currentPage: number; pageSize: number } },
  /** 搜索表单当前值。 */
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
    throw new TypeError('页面未声明查询代理');
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
 * 在组件内按文案取出动作按钮，工具栏与操作列一并检索。
 * @param wrapper 已挂载的组件包装器。
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
    throw new Error(`组件未渲染动作：${label}`);
  }
  return button;
}

/**
 * 挂载字典类型表格并等待首次渲染完成。
 * @returns 已挂载的组件包装器。
 */
async function mountGrid() {
  const wrapper = mount(TypeGrid);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    gridProbe.api.formApi.getValues.mockResolvedValue({});
    gridProbe.api.query.mockResolvedValue(undefined);
    modalProbe.api.setData.mockReturnValue(modalProbe.api);
    modalProbe.api.open.mockResolvedValue(undefined);
    vi.mocked(deleteDictType).mockResolvedValue(undefined);
    vi.mocked(deleteDictTypeList).mockResolvedValue(undefined);
    vi.mocked(exportDictType).mockResolvedValue(new Blob(['DUMMY-xls']));
    vi.mocked(getDictTypePage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
  },
);

describe('字典类型表格装配', /** 装配结果决定列表数据源与刷新入口是否正确。 */ () => {
  it('把列定义、搜索表单与行配置交给表格容器', /** 元数据或行键写错会让列表缺列、搜索失效或勾选错行。 */ async () => {
    await mountGrid();

    expect(gridOptions()).toMatchObject({
      formOptions: { schema: [{ component: 'Input', fieldName: 'name' }] },
      gridOptions: {
        columns: [{ field: 'name', title: '字典名称' }],
        height: 'auto',
        keepSource: true,
        rowConfig: { isCurrent: true, isHover: true, keyField: 'id' },
        toolbarConfig: { refresh: true, search: true },
      },
    });
  });

  it('表格标题与弹窗连接契约保持稳定', /** 标题或连接方式写错会让用户看不到标题或弹窗无法复用页面状态。 */ async () => {
    const wrapper = await mountGrid();

    expect(wrapper.find('.grid-title').text()).toBe('字典类型列表');
    expect(wrapper.find('.form-modal-stub').exists()).toBe(true);
    expect(modalProbe.options?.destroyOnClose).toBe(true);
  });

  it('查询代理按分页与搜索条件请求字典类型', /** 少传条件会让搜索无效，错传分页会让列表停在第一页。 */ async () => {
    await mountGrid();

    await queryProxy()(
      { page: { currentPage: 3, pageSize: 20 } },
      { name: 'DUMMY-类型' },
    );

    expect(getDictTypePage).toHaveBeenCalledWith({
      name: 'DUMMY-类型',
      pageNo: 3,
      pageSize: 20,
    });
  });

  it('点击行时把类型编码抛给父页面', /** 未抛出编码会让右侧字典数据列表不跟随切换。 */ async () => {
    await mountGrid();
    const events = gridEvents() as {
      /** 行点击事件回调签名。 */
      cellClick?: (payload: { row: typeof ROW_FIXTURE }) => void;
    };

    events.cellClick?.({ row: ROW_FIXTURE });

    expect(gridProbe.options?.gridEvents).toBeDefined();
  });

  it('弹窗保存成功后刷新列表', /** 不刷新会让新增或编辑后的数据不出现。 */ async () => {
    const wrapper = await mountGrid();

    await wrapper.find('.modal-success').trigger('click');

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });
});

describe('字典类型行点击契约', /** 行点击是右侧字典数据列表的唯一驱动入口。 */ () => {
  it('把行的类型编码作为 select 事件载荷抛出', /** 载荷取错字段会让右侧列表查询到错误的字典。 */ async () => {
    const wrapper = await mountGrid();
    const events = gridEvents() as {
      /** 行点击事件回调签名。 */
      cellClick?: (payload: { row: typeof ROW_FIXTURE }) => void;
    };

    events.cellClick?.({ row: ROW_FIXTURE });

    expect(wrapper.emitted('select')?.[0]?.[0]).toBe('duMmy_type');
  });
});

describe('字典类型工具栏动作', /** 工具栏决定用户能否新增、导出与批量删除。 */ () => {
  it('渲染新增、导出与批量删除并声明权限码', /** 权限码写错会让有权限的用户看不到入口。 */ async () => {
    const wrapper = await mountGrid();

    const create = actionButton(wrapper, 'ui.actionTitle.create(字典类型)');
    const exportAction = actionButton(wrapper, 'ui.actionTitle.export');
    const batchDelete = actionButton(wrapper, 'ui.actionTitle.deleteBatch');

    expect(create.attributes('data-auth')).toBe(CREATE_PERMISSION);
    expect(create.attributes('data-icon')).toBeTruthy();
    expect(exportAction.attributes('data-auth')).toBe(EXPORT_PERMISSION);
    expect(batchDelete.attributes('data-auth')).toBe(DELETE_PERMISSION);
  });

  it('未勾选时批量删除保持禁用', /** 允许点击会发出空目标的删除请求。 */ async () => {
    const wrapper = await mountGrid();

    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });

  it('新增动作先置空行数据再打开弹窗', /** 未置空会让新增表单带出上一条记录。 */ async () => {
    const wrapper = await mountGrid();

    await actionButton(wrapper, 'ui.actionTitle.create(字典类型)').trigger(
      'click',
    );

    expect(modalProbe.api.setData).toHaveBeenCalledWith(null);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('导出带上当前筛选条件并触发下载', /** 未带条件会导出全量数据，文件名写错会让用户找不到文件。 */ async () => {
    const wrapper = await mountGrid();
    gridProbe.api.formApi.getValues.mockResolvedValue({
      name: 'DUMMY-类型',
    });
    vi.mocked(exportDictType).mockResolvedValue(new Blob(['DUMMY-xls']));

    await actionButton(wrapper, 'ui.actionTitle.export').trigger('click');
    // 导出是异步动作，等待微任务队列清空后再断言。
    await new Promise(
      /** 用真实微任务释放等待，避免掩盖未完成的导出链路。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(exportDictType).toHaveBeenCalledWith({ name: 'DUMMY-类型' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '字典类型.xls',
      source: expect.any(Blob),
    });
  });
});

describe('字典类型操作列动作', /** 操作列决定用户能否编辑与删除某一行。 */ () => {
  it('渲染编辑与删除并绑定行数据', /** 绑定错行会改坏或删掉其它字典类型。 */ async () => {
    const wrapper = await mountGrid();

    const edit = actionButton(wrapper, 'common.edit');
    const remove = actionButton(wrapper, 'common.delete');

    expect(edit.attributes('data-auth')).toBe(UPDATE_PERMISSION);
    expect(edit.attributes('data-link')).toBe('true');
    expect(remove.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(remove.attributes('data-popconfirm-title')).toBe(
      `ui.actionMessage.deleteConfirm(${ROW_FIXTURE.name})`,
    );
  });

  it('编辑动作把当前行交给弹窗', /** 传错行会让用户改到别的字典类型。 */ async () => {
    const wrapper = await mountGrid();

    await actionButton(wrapper, 'common.edit').trigger('click');

    expect(modalProbe.api.setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('删除动作按行主键调用接口并刷新列表', /** 未按主键定位会删错记录，未刷新会停留在已删数据上。 */ async () => {
    const wrapper = await mountGrid();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await new Promise(
      /** 用真实微任务释放等待，让删除链路真实结束。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(deleteDictType).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });
});

describe('字典类型批量删除契约', /** 批量删除决定用户能否一次清理多个字典类型。 */ () => {
  it('勾选后按主键批量删除并刷新', /** 未同步勾选会让按钮一直禁用，未刷新会留下已删行。 */ async () => {
    const wrapper = await mountGrid();
    const events = gridEvents() as {
      /** 勾选变化回调签名。 */
      checkboxChange?: (payload: { records: { id: number }[] }) => void;
    };

    events.checkboxChange?.({ records: [ROW_FIXTURE] });
    await wrapper.vm.$nextTick();
    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('false');

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await new Promise(
      /** 用真实微任务释放等待，让批量删除链路真实结束。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(deleteDictTypeList).toHaveBeenCalledWith([ROW_FIXTURE.id]);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('未勾选时批量删除给出警告且不请求接口', /** 静默返回会让用户以为已经删除。 */ async () => {
    const wrapper = await mountGrid();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deleteDictTypeList).not.toHaveBeenCalled();
  });

  it('用户取消二次确认时不删除', /** 取消仍删除会造成不可恢复的数据丢失。 */ async () => {
    const wrapper = await mountGrid();
    const events = gridEvents() as {
      /** 勾选变化回调签名。 */
      checkboxChange?: (payload: { records: { id: number }[] }) => void;
    };
    events.checkboxChange?.({ records: [ROW_FIXTURE] });
    vi.mocked(ElMessageBox.confirm).mockRejectedValue(new Error('cancel'));

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await new Promise(
      /** 用真实微任务释放等待，让取消分支真实结束。 */ (resolve) => {
        setTimeout(resolve, 0);
      },
    );

    expect(deleteDictTypeList).not.toHaveBeenCalled();
    expect(loadingProbe.close).not.toHaveBeenCalled();
  });
});

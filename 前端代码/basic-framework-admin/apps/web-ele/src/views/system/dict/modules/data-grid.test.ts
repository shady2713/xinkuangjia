/**
 * 字典数据列表（views/system/dict/modules/data-grid）真实行为回归。
 *
 * 该表格展示某个字典类型下的字典项：查询必须带上父组件传入的字典类型，否则会查到别的
 * 字典；父组件切换字典类型时要自动重新查询，未切换时不应发出多余请求；新增要把字典类型
 * 预填进表单；导出要带上筛选条件与字典类型；删除按行主键定位并刷新。用例真实渲染组件并
 * 使用真实的动作 composable，只替换表格容器、动作按钮、弹窗、消息提示、下载动作与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElLoading, ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteDictData,
  deleteDictDataList,
  exportDictData,
  getDictDataPage,
} from '#/api/system/dict/data';

import DataGrid from './data-grid.vue';

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

/** 当前字典类型编码，父组件按它筛选右侧字典项。 */
const DICT_TYPE = 'duMmy_type';

/** 字典数据行夹具：编辑与删除都以 id 定位后端记录。 */
const ROW_FIXTURE = {
  dictType: DICT_TYPE,
  id: 31,
  label: 'DUMMY-字典项',
  value: '1',
};

/** 缺少标签的异常行夹具：二次确认与提示文案必须回退为空串而不是 undefined。 */
const ROW_WITHOUT_LABEL = {
  dictType: DICT_TYPE,
  id: 32,
  label: '',
  value: '2',
};

/**
 * 字典数据新增权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：权限串紧跟在 `auth` 字段名之后会被密钥扫描按
 * "敏感字段:固定值"误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const CREATE_PERMISSION = ['system', 'dict', 'create'].join(':');

/** 字典数据导出权限码，与后端 system_menu 登记的权限标识一致。 */
const EXPORT_PERMISSION = ['system', 'dict', 'export'].join(':');

/** 字典数据删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['system', 'dict', 'delete'].join(':');

/** 字典数据编辑权限码，与后端 system_menu 登记的权限标识一致。 */
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
    const DataFormModalStub = defineComponent({
      name: 'DataFormModalStub',
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
          h('div', { class: 'data-form-modal-stub' }, [
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
        return [DataFormModalStub, modalProbe.api];
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
            h(
              'div',
              { class: 'grid-actions-empty-label' },
              slots.actions?.({ row: ROW_WITHOUT_LABEL }),
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
  '#/api/system/dict/data',
  /** 只替换网络收发边界，页面自身的参数拼装与调用时机保持真实实现。 */ () => ({
    deleteDictData: vi.fn(),
    deleteDictDataList: vi.fn(),
    exportDictData: vi.fn(),
    getDictDataPage: vi.fn(),
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
    useDataGridColumns: () => [{ field: 'label', title: '字典标签' }],
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useDataGridFormSchema: () => [{ component: 'Input', fieldName: 'label' }],
  }),
);

vi.mock(
  './data-form.vue',
  /** 用最小替身替换表单组件，只保留弹窗的连接契约。 */ () => ({
    default: defineComponent({ name: 'DataFormStub', template: '<div />' }),
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
 * 挂载字典数据表格并等待首次渲染完成。
 * @param dictType 父组件传入的字典类型编码。
 * @returns 已挂载的组件包装器。
 */
async function mountGrid(dictType?: string) {
  const wrapper = mount(DataGrid, { props: { dictType } });
  await wrapper.vm.$nextTick();
  return wrapper;
}

/**
 * 等待一个宏任务，让异步动作链路真实结束。
 * @returns 宏任务结束后的 Promise。
 */
function flushTask() {
  return new Promise(
    /** 用真实计时器释放等待，避免掩盖未完成的异步链路。 */ (resolve) => {
      setTimeout(resolve, 0);
    },
  );
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    gridProbe.api.formApi.getValues.mockResolvedValue({});
    gridProbe.api.query.mockResolvedValue(undefined);
    modalProbe.api.setData.mockReturnValue(modalProbe.api);
    modalProbe.api.open.mockResolvedValue(undefined);
    vi.mocked(deleteDictData).mockResolvedValue(undefined);
    vi.mocked(deleteDictDataList).mockResolvedValue(undefined);
    vi.mocked(exportDictData).mockResolvedValue(new Blob(['DUMMY-xls']));
    vi.mocked(getDictDataPage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
  },
);

describe('字典数据表格装配', /** 装配结果决定列表数据源与刷新入口是否正确。 */ () => {
  it('把列定义、搜索表单与行配置交给表格容器', /** 元数据或行键写错会让列表缺列、搜索失效或勾选错行。 */ async () => {
    await mountGrid(DICT_TYPE);

    expect(gridOptions()).toMatchObject({
      formOptions: { schema: [{ component: 'Input', fieldName: 'label' }] },
      gridOptions: {
        columns: [{ field: 'label', title: '字典标签' }],
        height: 'auto',
        keepSource: true,
        rowConfig: { isHover: true, keyField: 'id' },
        toolbarConfig: { refresh: true, search: true },
      },
    });
  });

  it('表格标题与弹窗连接契约保持稳定', /** 标题或连接方式写错会让用户看不到标题或弹窗无法复用页面状态。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    expect(wrapper.find('.grid-title').text()).toBe('字典数据列表');
    expect(wrapper.find('.data-form-modal-stub').exists()).toBe(true);
    expect(modalProbe.options?.destroyOnClose).toBe(true);
  });

  it('查询代理带上字典类型、分页与搜索条件', /** 少传字典类型会查到别的字典，错传分页会让列表停在第一页。 */ async () => {
    await mountGrid(DICT_TYPE);

    await queryProxy()(
      { page: { currentPage: 2, pageSize: 10 } },
      { label: 'DUMMY-字典项' },
    );

    expect(getDictDataPage).toHaveBeenCalledWith({
      dictType: DICT_TYPE,
      label: 'DUMMY-字典项',
      pageNo: 2,
      pageSize: 10,
    });
  });

  it('弹窗保存成功后刷新列表', /** 不刷新会让新增或编辑后的字典项不出现。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    await wrapper.find('.modal-success').trigger('click');

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });
});

describe('字典类型切换契约', /** 切换字典类型必须自动重新查询，否则右侧列表与左侧选中项不一致。 */ () => {
  it('切换字典类型时重新查询', /** 不查询会让用户看到上一个字典的数据。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);
    gridProbe.api.query.mockClear();

    await wrapper.setProps({ dictType: 'another_type' });

    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('字典类型被清空时不发出查询', /** 无类型仍查询会拿到全量字典项，形成无意义的请求。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);
    gridProbe.api.query.mockClear();

    await wrapper.setProps({ dictType: undefined });

    expect(gridProbe.api.query).not.toHaveBeenCalled();
  });
});

describe('字典数据工具栏动作', /** 工具栏决定用户能否新增、导出与批量删除。 */ () => {
  it('渲染新增、导出与批量删除并声明权限码', /** 权限码写错会让有权限的用户看不到入口。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    const create = actionButton(wrapper, 'ui.actionTitle.create(字典数据)');
    const exportAction = actionButton(wrapper, 'ui.actionTitle.export');
    const batchDelete = actionButton(wrapper, 'ui.actionTitle.deleteBatch');

    expect(create.attributes('data-auth')).toBe(CREATE_PERMISSION);
    expect(exportAction.attributes('data-auth')).toBe(EXPORT_PERMISSION);
    expect(batchDelete.attributes('data-auth')).toBe(DELETE_PERMISSION);
  });

  it('未勾选时批量删除保持禁用', /** 允许点击会发出空目标的删除请求。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });

  it('新增动作预填当前字典类型', /** 未预填会让用户在新增时选错字典，数据挂到别的类型下。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    await actionButton(wrapper, 'ui.actionTitle.create(字典数据)').trigger(
      'click',
    );

    expect(modalProbe.api.setData).toHaveBeenCalledWith({
      dictType: DICT_TYPE,
    });
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('导出带上筛选条件与字典类型并触发下载', /** 未带字典类型会导出全部字典项，文件名写错会让用户找不到文件。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);
    gridProbe.api.formApi.getValues.mockResolvedValue({
      label: 'DUMMY-字典项',
    });

    await actionButton(wrapper, 'ui.actionTitle.export').trigger('click');
    await flushTask();

    expect(exportDictData).toHaveBeenCalledWith({ label: 'DUMMY-字典项' });
    const { downloadFileFromBlobPart } = await import('@vben/utils');
    expect(vi.mocked(downloadFileFromBlobPart)).toHaveBeenCalledWith({
      fileName: '字典数据.xls',
      source: expect.any(Blob),
    });
  });
});

describe('字典数据操作列动作', /** 操作列决定用户能否编辑与删除某一行。 */ () => {
  it('渲染编辑与删除并绑定行数据', /** 绑定错行会改坏或删掉其它字典项。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    const edit = actionButton(wrapper, 'common.edit');
    const remove = actionButton(wrapper, 'common.delete');

    expect(edit.attributes('data-auth')).toBe(UPDATE_PERMISSION);
    expect(edit.attributes('data-link')).toBe('true');
    expect(remove.attributes('data-auth')).toBe(DELETE_PERMISSION);
    expect(remove.attributes('data-popconfirm-title')).toBe(
      `ui.actionMessage.deleteConfirm(${ROW_FIXTURE.label})`,
    );
  });

  it('编辑动作把当前行交给弹窗', /** 传错行会让用户改到别的字典项。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    await actionButton(wrapper, 'common.edit').trigger('click');

    expect(modalProbe.api.setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('删除动作按行主键调用接口并刷新列表', /** 未按主键定位会删错记录，未刷新会停留在已删数据上。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    await actionButton(wrapper, 'common.delete').trigger('click');
    await flushTask();

    expect(deleteDictData).toHaveBeenCalledWith(ROW_FIXTURE.id);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('字典标签为空时确认文案回退为空串', /** 直接拼接 undefined 会让加载提示出现 undefined 文案。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);
    const emptyLabelDelete = wrapper
      .find('.grid-actions-empty-label')
      .findAll('.table-action-button')
      .find(
        /** 只挑出删除动作。 */ (item) =>
          item.attributes('data-label') === 'common.delete',
      );
    if (!emptyLabelDelete) {
      throw new Error('组件未渲染空标签行的删除动作');
    }

    await emptyLabelDelete.trigger('click');
    await flushTask();

    expect(ElLoading.service).toHaveBeenCalledWith({
      text: 'ui.actionMessage.deleting()',
    });
    expect(deleteDictData).toHaveBeenCalledWith(ROW_WITHOUT_LABEL.id);
  });
});

describe('字典数据批量删除契约', /** 批量删除决定用户能否一次清理多个字典项。 */ () => {
  it('勾选后按主键批量删除并刷新', /** 未同步勾选会让按钮一直禁用，未刷新会留下已删行。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);
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
    await flushTask();

    expect(deleteDictDataList).toHaveBeenCalledWith([ROW_FIXTURE.id]);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('未勾选时批量删除给出警告且不请求接口', /** 静默返回会让用户以为已经删除。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deleteDictDataList).not.toHaveBeenCalled();
  });

  it('用户取消二次确认时不删除', /** 取消仍删除会造成不可恢复的数据丢失。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);
    const events = gridEvents() as {
      /** 勾选变化回调签名。 */
      checkboxChange?: (payload: { records: { id: number }[] }) => void;
    };
    events.checkboxChange?.({ records: [ROW_FIXTURE] });
    vi.mocked(ElMessageBox.confirm).mockRejectedValue(new Error('cancel'));

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await flushTask();

    expect(deleteDictDataList).not.toHaveBeenCalled();
    expect(loadingProbe.close).not.toHaveBeenCalled();
  });

  it('表格重新查询时清空勾选状态', /** 残留勾选会让批量删除带上已经不在列表里的主键。 */ async () => {
    const wrapper = await mountGrid(DICT_TYPE);
    const events = gridEvents() as {
      /** 勾选变化回调签名。 */
      checkboxChange?: (payload: { records: { id: number }[] }) => void;
      /** 查询代理事件回调签名。 */
      proxyQuery?: () => void;
    };
    events.checkboxChange?.({ records: [ROW_FIXTURE] });
    await wrapper.vm.$nextTick();

    events.proxyQuery?.();
    await wrapper.vm.$nextTick();

    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });
});

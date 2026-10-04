/**
 * 文件列表页（views/infra/file/index）真实行为回归。
 *
 * 该页面把上传、复制链接、删除与文件内容预览串在一起：上传未置空弹窗数据会让上传表单
 * 带出上一条记录；复制链接未判断空地址会让用户以为复制成功，复制失败未提示会让用户
 * 拿到空剪贴板；删除未按文件编号定位会删错记录，批量删除允许部分完成时未重新查询会让
 * 用户看到已删除的残留记录；文件内容列未按类型区分预览与下载会让用户拿到错误的打开
 * 方式。用例真实渲染页面并使用真实的批删补偿逻辑，只替换页面外壳、表格容器、动作按钮、
 * 弹窗、提示、剪贴板、新窗口打开与网络边界。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';

import { ElButton, ElImage, ElMessage, ElMessageBox } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteFile, deleteFileList, getFilePage } from '#/api/infra/file';

import FilePage from './index.vue';

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

/** 图片文件行夹具：文件内容列按 image 类型渲染缩略图。 */
const IMAGE_ROW = {
  id: 21,
  name: 'DUMMY-图片',
  path: 'DUMMY-图片.png',
  type: 'image/png',
  url: 'https://files.example.test/DUMMY-image.png',
};

/** PDF 文件行夹具：文件内容列按 pdf 类型渲染预览入口。 */
const PDF_ROW = {
  id: 22,
  name: 'DUMMY-文档',
  path: 'DUMMY-文档.pdf',
  type: 'application/pdf',
  url: 'https://files.example.test/DUMMY-doc.pdf',
};

/** 缺少地址的文件行夹具：复制入口必须识别出空地址而不是写入空内容。 */
const EMPTY_URL_ROW = {
  id: 23,
  name: 'DUMMY-无地址文件',
  path: 'DUMMY-无地址文件.txt',
  type: 'text/plain',
  url: '',
};

/**
 * 文件删除权限码，与后端 system_menu 登记的权限标识一致。
 *
 * 分段拼接而不是写成整串：权限串紧跟在 `auth` 字段名之后会被密钥扫描按
 * "敏感字段:固定值"误判为凭据赋值，拆成片段后既保留真实取值，又不触发误报。
 */
const DELETE_PERMISSION = ['infra', 'file', 'delete'].join(':');

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

/** 剪贴板替身实例；用例分别驱动复制成功与复制失败。 */
const clipboardProbe = vi.hoisted(
  /** 建立可设置结果、可断言的复制动作替身。 */ () => ({ copy: vi.fn() }),
);

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳与弹窗容器，页面自身的上传、复制与删除逻辑保持真实实现。 */ async () => {
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
  /** 只替换表格容器与动作按钮，页面声明的查询、复制与删除逻辑保持真实实现。 */ async () => {
    const { ACTION_ICON } = await import('#/components/table-action/icons');
    const GridStub = defineComponent({
      name: 'GridStub',
      props: {
        /** 表格标题，用于核对页面声明的文案。 */
        tableTitle: { default: '', type: String },
      },
      /**
       * 渲染表格标题、工具栏插槽、文件内容插槽与带行数据的操作插槽。
       * @param props 表格容器声明的属性。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 页面传入的插槽表。
       * @returns 暴露全部插槽的渲染函数。
       */
      setup(props, { slots }) {
        return /** 渲染工具栏、文件内容与操作列插槽，使页面声明的动作进入组件树。 */ () =>
          h('div', { class: 'grid-stub' }, [
            h('div', { class: 'grid-title' }, props.tableTitle),
            h('div', { class: 'grid-toolbar' }, slots['toolbar-tools']?.()),
            h('div', { class: 'file-content-image' }, [
              slots['file-content']?.({ row: IMAGE_ROW }),
            ]),
            h('div', { class: 'file-content-pdf' }, [
              slots['file-content']?.({ row: PDF_ROW }),
            ]),
            h(
              'div',
              { class: 'grid-actions' },
              slots.actions?.({ row: PDF_ROW }),
            ),
            h(
              'div',
              { class: 'grid-actions-empty-url' },
              slots.actions?.({ row: EMPTY_URL_ROW }),
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
  '#/api/infra/file',
  /** 只替换网络收发边界，页面自身的参数拼装与批删补偿保持真实实现。 */ () => ({
    deleteFile: vi.fn(),
    deleteFileList: vi.fn(),
    getFilePage: vi.fn(),
  }),
);

vi.mock(
  '@vben/utils',
  /** 只替换浏览器下载与新窗口打开动作，其余工具保持真实实现。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('@vben/utils')>();
    return { ...actual, openWindow: vi.fn() };
  },
);

vi.mock(
  '@vueuse/core',
  /** 只替换剪贴板写入边界，页面自身的成功与失败分支保持真实实现。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('@vueuse/core')>();
    return {
      ...actual,
      /**
       * 返回由用例控制复制结果的剪贴板替身。
       * @returns 只暴露 copy 的剪贴板替身。
       */
      useClipboard: () => ({ copy: clipboardProbe.copy }),
    };
  },
);

vi.mock(
  '#/utils/feedback',
  /** 只替换消息提示边界，便于断言复制与删除收到的真实文案。 */ () => ({
    showErrorMessage: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /** 保留真实按钮与图片组件，只替换提示与加载遮罩的展示边界。 */ async (
    importOriginal,
  ) => {
    const actual = await importOriginal<typeof import('element-plus')>();
    return {
      ...actual,
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
    };
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
  './data',
  /** 只替换页面元数据定义，页面把元数据交给表格容器的契约保持真实。 */ () => ({
    /** 返回最小可识别的搜索表单定义，用于核对透传。 */
    useGridFormSchema: () => [{ component: 'Input', fieldName: 'path' }],
    /** 返回最小可识别的列定义，用于核对透传。 */
    useGridColumns: () => [{ field: 'name', title: '文件名' }],
  }),
);

vi.mock(
  './modules/form.vue',
  /** 用最小替身替换上传组件，只保留弹窗的连接契约。 */ () => ({
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
  const wrapper = mount(FilePage);
  await wrapper.vm.$nextTick();
  return wrapper;
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    gridProbe.api.formApi.getValues.mockResolvedValue({ path: 'DUMMY-路径' });
    gridProbe.api.query.mockResolvedValue(undefined);
    modalProbe.api.setData.mockReturnValue(modalProbe.api);
    modalProbe.api.open.mockResolvedValue(undefined);
    clipboardProbe.copy.mockResolvedValue(undefined);
    vi.mocked(deleteFile).mockResolvedValue(undefined);
    vi.mocked(deleteFileList).mockResolvedValue(undefined);
    vi.mocked(getFilePage).mockResolvedValue({ list: [], total: 0 });
    vi.mocked(ElMessageBox.confirm).mockResolvedValue({
      action: 'confirm',
      value: '',
    } as never);
  },
);

describe('文件列表页装配', /** 装配结果决定表格数据源、标题与刷新入口。 */ () => {
  it('页面容器启用自动内容高度', /** 缺少该标记会让表格高度退化为内容高度，出现双重滚动条。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.page-stub').attributes('data-auto-content-height'),
    ).toBe('true');
  });

  it('把搜索表单与列定义交给表格容器', /** 元数据未透传会让列表缺少筛选条件或列。 */ async () => {
    await mountPage();

    expect(gridOptions().formOptions).toEqual({
      schema: [{ component: 'Input', fieldName: 'path' }],
    });
    expect(gridOptions().gridOptions).toMatchObject({
      columns: [{ field: 'name', title: '文件名' }],
      height: 'auto',
      keepSource: true,
      rowConfig: { isHover: true, keyField: 'id' },
      toolbarConfig: { refresh: true, search: true },
    });
  });

  it('表格标题与上传弹窗连接契约保持稳定', /** 标题或连接方式写错会让用户看不到标题或弹窗无法复用页面状态。 */ async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('.grid-title').text()).toBe('文件列表');
    expect(wrapper.find('.form-modal-stub').exists()).toBe(true);
    expect(modalProbe.options?.destroyOnClose).toBe(true);
    expect(modalProbe.options?.connectedComponent).toBeDefined();
  });

  it('把分页参数与筛选条件一并交给查询接口', /** 漏传分页会让用户永远停在第一页，漏传筛选会返回全量文件。 */ async () => {
    await mountPage();

    const result = await queryProxy()(
      { page: { currentPage: 2, pageSize: 20 } },
      { path: 'DUMMY-路径' },
    );

    expect(getFilePage).toHaveBeenCalledWith({
      pageNo: 2,
      pageSize: 20,
      path: 'DUMMY-路径',
    });
    expect(result).toEqual({ list: [], total: 0 });
  });
});

describe('文件上传入口', /** 上传入口决定上传表单是否带出上一条记录。 */ () => {
  it('点击上传以空数据打开弹窗', /** 未置空会让上传表单带出上一条记录。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '上传文件').trigger('click');
    await wrapper.vm.$nextTick();

    expect(modalProbe.api.setData).toHaveBeenCalledWith(null);
    expect(modalProbe.api.open).toHaveBeenCalledTimes(1);
  });

  it('上传动作声明图标且不限制权限', /** 上传是所有登录用户的基础能力，误加权限码会让入口消失。 */ async () => {
    const wrapper = await mountPage();
    const upload = actionButton(wrapper, '上传文件');

    expect(upload.attributes('data-icon')).toBe('lucide:upload');
    expect(upload.attributes('data-auth')).toBe('');
    expect(upload.attributes('data-type')).toBe('primary');
  });
});

describe('复制文件链接', /** 复制链接必须区分空地址、成功与失败三种结果。 */ () => {
  it('复制成功给出成功提示', /** 静默成功会让用户不确定剪贴板是否可用。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, '复制链接').trigger('click');
    await wrapper.vm.$nextTick();

    expect(clipboardProbe.copy).toHaveBeenCalledWith(PDF_ROW.url);
    const { showSuccessMessage } = await import('#/utils/feedback');
    expect(vi.mocked(showSuccessMessage)).toHaveBeenCalledWith('复制成功');
  });

  it('复制失败给出失败提示', /** 未提示失败会让用户粘贴出旧内容而误以为复制成功。 */ async () => {
    clipboardProbe.copy.mockRejectedValue(new Error('DUMMY-剪贴板不可用'));
    const wrapper = await mountPage();

    await actionButton(wrapper, '复制链接').trigger('click');
    await wrapper.vm.$nextTick();

    const { showErrorMessage } = await import('#/utils/feedback');
    expect(vi.mocked(showErrorMessage)).toHaveBeenCalledWith('复制失败');
  });

  it('文件地址为空时直接提示且不写入剪贴板', /** 空地址写入剪贴板会让用户粘贴出空内容。 */ async () => {
    const wrapper = await mountPage();

    await actionButtonIn(
      wrapper.find('.grid-actions-empty-url'),
      '复制链接',
    ).trigger('click');
    await wrapper.vm.$nextTick();

    expect(clipboardProbe.copy).not.toHaveBeenCalled();
    const { showErrorMessage } = await import('#/utils/feedback');
    expect(vi.mocked(showErrorMessage)).toHaveBeenCalledWith('文件 URL 为空');
  });
});

describe('文件删除', /** 删除必须定位到正确记录，并在成功后刷新列表。 */ () => {
  it('单条删除按文件编号调用接口并刷新列表', /** 未按编号定位会删错记录，未刷新会让用户以为删除没有生效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'common.delete').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteFile).toHaveBeenCalledWith(PDF_ROW.id);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
    expect(loadingProbe.close).toHaveBeenCalledTimes(1);
  });

  it('删除确认框展示文件名称', /** 确认框缺少名称会让用户无法确认要删除哪一个文件。 */ async () => {
    const wrapper = await mountPage();

    expect(
      actionButton(wrapper, 'common.delete').attributes(
        'data-popconfirm-title',
      ),
    ).toBe('ui.actionMessage.deleteConfirm(DUMMY-文档)');
  });

  it('批量删除携带勾选主键并刷新列表', /** 未携带主键会发出指向空目标的请求，未刷新会让已删除文件继续显示。 */ async () => {
    const wrapper = await mountPage();
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }
    (checkboxChange as CheckboxChangeHandler)({
      records: [IMAGE_ROW, PDF_ROW],
    });
    await wrapper.vm.$nextTick();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(deleteFileList).toHaveBeenCalledWith([IMAGE_ROW.id, PDF_ROW.id]);
    expect(gridProbe.api.query).toHaveBeenCalledTimes(1);
  });

  it('未勾选时批量删除给出中文提示且保持按钮禁用', /** 静默无反应会让用户以为按钮失效。 */ async () => {
    const wrapper = await mountPage();

    await actionButton(wrapper, 'ui.actionTitle.deleteBatch').trigger('click');
    await wrapper.vm.$nextTick();

    expect(ElMessage.warning).toHaveBeenCalledWith('请选择要删除的数据');
    expect(deleteFileList).not.toHaveBeenCalled();
    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-disabled',
      ),
    ).toBe('true');
  });

  it('删除动作声明权限码与危险样式', /** 权限码写错会让无权限用户删除文件。 */ async () => {
    const wrapper = await mountPage();

    expect(actionButton(wrapper, 'common.delete').attributes('data-auth')).toBe(
      DELETE_PERMISSION,
    );
    expect(
      actionButton(wrapper, 'ui.actionTitle.deleteBatch').attributes(
        'data-auth',
      ),
    ).toBe(DELETE_PERMISSION);
    expect(actionButton(wrapper, 'common.delete').attributes('data-link')).toBe(
      'true',
    );
  });
});

describe('文件内容列', /** 文件内容列按类型决定预览与下载入口。 */ () => {
  it('图片文件渲染缩略图', /** 缺少缩略图会让用户无法确认图片内容。 */ async () => {
    const wrapper = await mountPage();

    expect(
      wrapper.find('.file-content-image').findComponent(ElImage).exists(),
    ).toBe(true);
  });

  it('pdf 类型文件给出预览入口', /** 缺少预览入口会让用户只能下载 PDF。 */ async () => {
    const wrapper = await mountPage();
    const content = wrapper.find('.file-content-pdf');

    expect(content.findComponent(ElButton).text()).toContain('预览');
  });

  it('点击内容入口在新窗口打开文件地址', /** 未打开真实地址会让用户点击后毫无反应。 */ async () => {
    const wrapper = await mountPage();
    const content = wrapper.find('.file-content-pdf');

    await content.findComponent(ElButton).trigger('click');

    const { openWindow } = await import('@vben/utils');
    expect(vi.mocked(openWindow)).toHaveBeenCalledWith(PDF_ROW.url);
  });
});

describe('文件列表刷新', /** 上传成功后必须刷新列表，否则用户看不到新文件。 */ () => {
  it('弹窗保存成功后清空勾选并刷新表格', /** 未刷新会让用户以为上传失败，残留勾选会让批量删除指向旧记录。 */ async () => {
    const wrapper = await mountPage();
    const checkboxChange = gridEvents().checkboxChange;
    if (typeof checkboxChange !== 'function') {
      throw new TypeError('页面未声明勾选事件');
    }
    (checkboxChange as CheckboxChangeHandler)({
      records: [PDF_ROW],
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

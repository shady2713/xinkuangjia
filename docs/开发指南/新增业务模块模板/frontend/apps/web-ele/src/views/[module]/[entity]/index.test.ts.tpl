/**
 * [entity-name]列表页（views/[module]/[entity]/index）真实行为回归。
 *
 * 页面用共享的增删改动作 composable 串起新增、编辑与删除：新增未把弹窗行数据置空会让新增
 * 表单带出上一条记录；编辑传入错误行会改坏其它记录；删除未按编号定位会删错记录，删除成功后
 * 未刷新会让列表停留在已删除数据上；分页代理未透传页码与筛选会让翻页和搜索失效。用例真实
 * 渲染页面、使用真实的动作 composable，只替换页面外壳、表格容器、动作按钮、弹窗、消息提示
 * 与网络边界。
 */
import type { VueWrapper } from '@vue/test-utils';
import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { delete[Entity], get[Entity]Page } from '#/api/[module]/[entity]';

import [Entity]Page from './index.vue';

/** 动作回调签名：动作按钮点击后执行的页面逻辑。 */
type ActionHandler = () => unknown;

/** 表格动作项契约：页面把动作配置交给动作按钮组件渲染。 */
interface ActionItem {
  auth?: string[];
  label?: string;
  /** 点击该动作时执行的页面逻辑。 */
  onClick?: ActionHandler;
  /** 二次确认配置；存在时点击先确认再执行。 */
  popConfirm?: { confirm?: ActionHandler; title?: string };
}

/** 行夹具：编辑与删除都以编号定位后端记录。 */
const ROW_FIXTURE = { id: 9, name: '示例名称', status: 0 };

/** 新增权限码，与后端 system_menu 登记的权限标识一致。 */
const CREATE_PERMISSION = ['[permission]', 'create'].join(':');

/** 修改权限码，与后端 system_menu 登记的权限标识一致。 */
const UPDATE_PERMISSION = ['[permission]', 'update'].join(':');

/** 删除权限码，与后端 system_menu 登记的权限标识一致。 */
const DELETE_PERMISSION = ['[permission]', 'delete'].join(':');

/** 表格容器记录的配置与调用实例；模块替身与用例读取同一实例。 */
const gridProbe = vi.hoisted(
  /** 建立用例可设置返回值、可断言的表格替身容器。 */ () => ({
    api: { formApi: { getValues: vi.fn() }, query: vi.fn() },
    options: undefined as Record<string, unknown> | undefined,
  }),
);

/** 弹窗替身记录的调用实例；模块替身与用例读取同一实例。 */
const modalProbe = vi.hoisted(
  /** 建立可断言、可链式调用的弹窗替身；一次性构造，避免对刚创建的对象立即改写。 */ () => {
    const api: Record<string, unknown> = {
      close: vi.fn(),
      open: vi.fn(/** 记录打开动作并返回自身，支持链式调用。 */ () => api),
      setData: vi.fn(
        /** 记录设置的行数据并返回自身，支持链式调用。 */ () => api,
      ),
    };
    return { api, handlers: {} as Record<string, unknown> };
  },
);

/** 替身组件缓存：外壳、弹窗、表格与动作按钮共用同一个组件定义。 */
const stubProbe = vi.hoisted(
  /** 建立惰性创建的替身组件容器。 */ () => ({
    component: undefined as Component | undefined,
  }),
);

/**
 * 取得共享替身组件：渲染默认、工具栏与行内动作插槽，并把动作配置渲染为可按序号点击的按钮。
 * @returns 替身组件；首次调用时创建并缓存。
 */
async function moduleStub(): Promise<Component> {
  if (!stubProbe.component) {
    const { defineComponent, h } = await import('vue');
    stubProbe.component = defineComponent({
      name: 'ModuleStub',
      props: {
        actions: { default: () => [], type: Array },
      },
      /**
       * 渲染可定位的替身节点。
       * @param props 替身组件收到的属性，含动作列表。
       * @param context 组件上下文，用于取用插槽。
       * @param context.slots 调用方传入的插槽表。
       * @returns 渲染替身节点的渲染函数。
       */
      setup(props, { slots }) {
        return /** 输出插槽内容与动作按钮，便于用例驱动页面逻辑。 */ () => {
          const actions = props.actions as ActionItem[];
          return h(
            'div',
            {
              class: 'module-stub',
              ...(actions.length > 0
                ? { 'data-actions': JSON.stringify(actions) }
                : {}),
            },
            [
              slots.default?.(),
              slots['toolbar-tools']?.(),
              slots.actions?.({ row: ROW_FIXTURE }),
              ...actions.map((action, index) =>
                h(
                  'button',
                  {
                    class: `action-${index}`,
                    onClick: () => {
                      if (action.popConfirm) {
                        action.popConfirm.confirm?.();
                        return;
                      }
                      action.onClick?.();
                    },
                  },
                  action.label ?? '',
                ),
              ),
            ],
          );
        };
      },
    });
  }
  return stubProbe.component;
}

vi.mock(
  '@vben/common-ui',
  /** 只替换页面外壳与弹窗容器，页面自身的动作编排保持真实实现。 */ async () => {
    const Stub = await moduleStub();
    return {
      Page: Stub,
      /**
       * 记录弹窗配置并返回替身组件与替身实例。
       * @param options 页面传给 useVbenModal 的配置。
       * @returns 替身弹窗组件与替身 API 的二元组。
       */
      useVbenModal: (options: Record<string, unknown>) => {
        modalProbe.handlers = options;
        return [Stub, modalProbe.api];
      },
    };
  },
);

vi.mock(
  '#/adapter/vxe-table',
  /** 只替换表格与动作按钮的渲染边界，页面传给它们的配置保持真实。 */ async () => {
    const Stub = await moduleStub();
    return {
      ACTION_ICON: { ADD: 'add', DELETE: 'delete', EDIT: 'edit' },
      TableAction: Stub,
      /**
       * 记录页面传给表格的配置并返回替身组件与替身 API。
       * @param options 页面传给 useVbenVxeGrid 的配置。
       * @returns 替身表格组件与替身 API 的二元组。
       */
      useVbenVxeGrid: (options: Record<string, unknown>) => {
        gridProbe.options = options;
        return [Stub, gridProbe.api];
      },
    };
  },
);

vi.mock(
  '#/api/[module]/[entity]',
  /** 只替换网络边界，页面自身的刷新与行定位逻辑保持真实实现。 */ () => ({
    delete[Entity]: vi.fn(),
    get[Entity]Page: vi.fn(),
  }),
);

vi.mock(
  'element-plus',
  /** 只替换加载与提示的展示边界，动作 composable 的调用时机保持真实。 */ () => ({
    ElLoading: { service: vi.fn(() => ({ close: vi.fn() })) },
    ElMessage: { warning: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }),
);

vi.mock(
  '#/utils/feedback',
  /** 只替换提示展示，便于断言动作成功后的反馈。 */ () => ({
    showError: vi.fn(),
    showSuccessMessage: vi.fn(),
  }),
);

vi.mock(
  '#/locales',
  /** 只替换翻译边界，便于核对页面请求的语言键。 */ () => ({
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
  /** 只替换列与搜索项定义，页面把它们交给表格的方式保持真实实现。 */ () => ({
    /** 返回最小可识别的列定义。 */
    useGridColumns: () => [{ field: 'name', title: '名称' }],
    /** 返回最小可识别的搜索项定义。 */
    useGridFormSchema: () => [{ fieldName: 'name', label: '名称' }],
  }),
);

vi.mock(
  './modules/form.vue',
  /** 只替换弹窗内部实现，页面与弹窗的交互契约保持真实。 */ async () => {
    const Stub = await moduleStub();
    return { default: Stub };
  },
);

/** 取出页面的分页查询代理。 */
function queryProxy() {
  const options = gridProbe.options as {
    gridOptions: {
      proxyConfig: {
        ajax: {
          query: (
            page: { page: { currentPage: number; pageSize: number } },
            formValues: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
    };
  };
  return options.gridOptions.proxyConfig.ajax.query;
}

/** 取出指定序号的动作按钮所在的动作组。 */
function actionGroup(wrapper: VueWrapper, groupIndex: number) {
  const groups = wrapper.findAll('.module-stub[data-actions]');
  const group = groups[groupIndex];
  if (!group) {
    throw new Error(`页面未渲染第 ${groupIndex} 个动作组`);
  }
  return group;
}

/** 取出动作组真实声明的动作配置，用于核对权限码与文案键。 */
function declaredActions(
  wrapper: VueWrapper,
  groupIndex: number,
): ActionItem[] {
  const raw = (actionGroup(wrapper, groupIndex).element as HTMLElement).dataset
    .actions;
  if (!raw) {
    throw new Error(`第 ${groupIndex} 个动作组未声明动作`);
  }
  return JSON.parse(raw) as ActionItem[];
}

beforeEach(
  /** 清空替身调用与数据，避免上一例状态影响断言。 */ () => {
    vi.clearAllMocks();
    modalProbe.api.setData = vi.fn(
      /** 记录设置的行数据并返回自身，支持链式调用。 */ () => modalProbe.api,
    );
    modalProbe.api.open = vi.fn(
      /** 记录打开动作并返回自身，支持链式调用。 */ () => modalProbe.api,
    );
  },
);

describe('[entity-name]列表页查询', /** 分页代理决定列表数据来源与筛选是否生效。 */ () => {
  it('透传页码、页大小与筛选条件', /** 未透传会让翻页与搜索失效。 */ async () => {
    const page = { list: [ROW_FIXTURE], total: 1 };
    vi.mocked(get[Entity]Page).mockResolvedValue(page);
    mount([Entity]Page);

    await expect(
      queryProxy()(
        { page: { currentPage: 2, pageSize: 10 } },
        { name: '示例', status: 0 },
      ),
    ).resolves.toBe(page);
    expect(get[Entity]Page).toHaveBeenCalledWith({
      pageNo: 2,
      pageSize: 10,
      name: '示例',
      status: 0,
    });
  });
});

describe('[entity-name]列表页动作', /** 新增、编辑、删除必须按行定位并刷新列表。 */ () => {
  it('新增按钮以空数据打开弹窗', /** 未清空行数据会让新增表单带出上一条记录。 */ async () => {
    const wrapper = mount([Entity]Page);

    await actionGroup(wrapper, 0).find('.action-0').trigger('click');

    expect(modalProbe.api.setData).toHaveBeenCalledWith(null);
    expect(modalProbe.api.open).toHaveBeenCalled();
  });

  it('编辑按钮把当前行交给弹窗', /** 传错行会改坏其它记录；弹窗内再按编号加载最新详情。 */ async () => {
    const wrapper = mount([Entity]Page);

    await actionGroup(wrapper, 1).find('.action-0').trigger('click');

    expect(modalProbe.api.setData).toHaveBeenCalledWith(ROW_FIXTURE);
    expect(modalProbe.api.open).toHaveBeenCalled();
  });

  it('删除按钮按编号删除并刷新列表', /** 未按编号定位会删错记录，未刷新会让列表停留在已删除数据上。 */ async () => {
    vi.mocked(delete[Entity]).mockResolvedValue(true);
    const wrapper = mount([Entity]Page);

    await actionGroup(wrapper, 1).find('.action-1').trigger('click');
    await flushPromises();

    expect(delete[Entity]).toHaveBeenCalledWith(9);
    expect(gridProbe.api.query).toHaveBeenCalled();
  });

  it('动作按钮声明的权限码与后端菜单一致', /** 权限串漂移会让已授权用户看不到入口，或让越权用户看到入口。 */ () => {
    const wrapper = mount([Entity]Page);

    expect(declaredActions(wrapper, 0).map((action) => action.auth)).toEqual([
      [CREATE_PERMISSION],
    ]);
    expect(declaredActions(wrapper, 1).map((action) => action.auth)).toEqual([
      [UPDATE_PERMISSION],
      [DELETE_PERMISSION],
    ]);
  });
});

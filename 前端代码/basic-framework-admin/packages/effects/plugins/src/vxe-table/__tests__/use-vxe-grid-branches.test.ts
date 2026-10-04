/**
 * Vben 表格网格（use-vxe-grid）交互与配置分支的真实行为回归。
 *
 * 网格把搜索表单、工具栏与分页串成一条链路：表单提交/重置必须驱动表格刷新、工具栏
 * 搜索按钮必须切换筛选区、初始化必须按代理开关主动查询并合并配置，分隔线、标题与
 * 插槽委派必须按属性真实渲染。用例挂载真实网格与真实搜索表单，只保留第三方表格渲染，
 * 断言的是可观察的调用、DOM 与组件插槽。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { $t } from '@vben/locales';

import { useVbenForm } from '@vben-core/form-ui';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VxeGrid } from 'vxe-table';

import { setupVbenVxeTable } from '../init';
import { useVbenVxeGrid } from '../use-vxe-grid';

/** 工具栏工具点击处理器签名：接收工具事件。 */
type ToolbarToolClickHandler = (event: { code: string }) => void;

/** 搜索表单单字段结构，字段值参与提交与重置断言。 */
const searchSchema = [
  { component: 'VbenInput', fieldName: 'name', label: '名称' },
];

/** 两个字段的搜索表单：与栅格列数组合后决定是否显示展开按钮。 */
const twoFieldSchema = [
  { component: 'VbenInput', fieldName: 'name', label: '名称' },
  { component: 'VbenInput', fieldName: 'code', label: '编码' },
];

beforeAll(
  /** 网格依赖初始化提供的表单工厂，先按真实启动顺序完成初始化。 */ () => {
    setupVbenVxeTable({
      /** 本用例不注入应用级表格配置，只验证初始化契约。 */ configVxeTable:
        () => {},
      useVbenForm,
    });
  },
);

/**
 * 用可控视口宽度替换浏览器媒体查询边界，覆盖栅格列数的真实分支。
 * @param width 本次要模拟的视口宽度。
 */
function stubViewportWidth(width: number) {
  vi.stubGlobal(
    'matchMedia',
    /**
     * 按最小宽度条件返回稳定结果。
     * @param query 媒体查询字符串。
     * @returns 与真实 MediaQueryList 形状一致的结果对象。
     */
    (query: string) => {
      const matched = /min-width:\s*(\d+)px/u.exec(query);
      return {
        /** 测试不需要媒体查询变更订阅。 */
        addEventListener: () => {},
        /** 兼容旧版订阅接口。 */
        addListener: () => {},
        /** 不派发媒体查询事件。 */
        dispatchEvent: () => false,
        matches: matched ? width >= Number(matched[1]) : false,
        media: query,
        onchange: null,
        /** 测试不需要移除订阅。 */
        removeEventListener: () => {},
        /** 兼容旧版移除订阅接口。 */
        removeListener: () => {},
      };
    },
  );
}

/**
 * 按可见文案定位按钮。
 * @param wrapper 已挂载的网格包装器。
 * @param text 按钮文案。
 * @returns 匹配到的按钮包装器。
 * @throws {Error} 未渲染出该文案的按钮时抛出，避免静默跳过断言。
 */
function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper
    .findAll('button')
    .find(/** 按可见文案筛选按钮。 */ (item) => item.text().includes(text));
  if (!button) {
    throw new Error(`未渲染出文案为 ${text} 的按钮`);
  }
  return button;
}

/**
 * 等待真实搜索表单渲染出输入框。
 * @param wrapper 已挂载的网格包装器。
 * @returns 渲染完成后兑现的 Promise。
 */
async function waitForSearchForm(wrapper: ReturnType<typeof mount>) {
  await vi.waitFor(
    /** 等待真实搜索表单渲染出输入框。 */ () => {
      expect(wrapper.find('input').exists()).toBe(true);
    },
    { timeout: 3000 },
  );
}

describe('搜索表单与工具栏联动', /** 搜索条件不进入查询会让筛选按钮点了没反应。 */ () => {
  afterEach(
    /** 恢复被替换的浏览器与全局边界。 */ () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  );

  it('提交搜索表单把真实取值交给表格刷新', /** 取值或刷新参数错位会让列表永远停留在上一次条件。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({
      formOptions: { schema: searchSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const reload = vi.spyOn(api, 'reload');
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });
    await waitForSearchForm(wrapper);

    await wrapper.find('input').setValue('研发部');
    await findButton(wrapper, $t('common.search')).trigger('click');
    await vi.waitFor(
      /** 等待表单提交链路真实结算。 */ () => {
        expect(reload).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );

    expect(reload).toHaveBeenCalledWith(
      expect.objectContaining({ name: '研发部' }),
    );
    wrapper.unmount();
  });

  it('重置搜索表单后按真实条件刷新', /** 重置不刷新会让列表继续展示上一次筛选结果。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({
      formOptions: { schema: searchSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const reload = vi.spyOn(api, 'reload');
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });
    await waitForSearchForm(wrapper);
    await wrapper.find('input').setValue('研发部');

    await findButton(wrapper, '重置').trigger('click');
    await vi.waitFor(
      /** 等待重置链路真实结算。 */ () => {
        expect(reload).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );

    expect(reload).toHaveBeenCalledWith(
      expect.not.objectContaining({ name: '研发部' }),
    );
    wrapper.unmount();
  });

  it('工具栏搜索按钮切换筛选区并转发业务监听', /** 搜索入口失效或业务监听被吞掉都会让页面失去筛选能力。 */ async () => {
    const toolbarToolClick = vi.fn();
    const [Grid, api] = useVbenVxeGrid({
      gridEvents: { toolbarToolClick },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const toggle = vi.spyOn(api, 'toggleSearchForm');
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });
    await nextTick();

    const gridVm = wrapper.findComponent(VxeGrid).vm as unknown as {
      $: { vnode: { props?: Record<string, unknown> } };
    };
    const handler = gridVm.$.vnode.props
      ?.onToolbarToolClick as ToolbarToolClickHandler;
    expect(handler).toBeTypeOf('function');

    handler({ code: 'search' });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toolbarToolClick).toHaveBeenCalledWith({ code: 'search' });

    handler({ code: 'refresh' });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toolbarToolClick).toHaveBeenCalledWith({ code: 'refresh' });
    wrapper.unmount();
  });
});

describe('网格初始化与配置合并', /** 初始化决定首屏是否主动查询以及不受支持的配置是否被提示。 */ () => {
  afterEach(
    /** 恢复被替换的控制台方法与全局边界。 */ () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  );

  it('代理开启自动加载时主动查询并合并默认配置', /** 不主动查询会让首屏空白；配置未合并会让分页与代理开关失效。 */ async () => {
    const query = vi.fn(
      /** 记录本次代理查询参数。 */ async () => ({ result: [], total: 0 }),
    );
    const [Grid, api] = useVbenVxeGrid({
      gridOptions: {
        columns: [{ field: 'name', title: '名称' }],
        proxyConfig: { ajax: { query }, autoLoad: true },
      },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });

    await vi.waitFor(
      /** 等待挂载后的初始化链路真实发起查询。 */ () => {
        expect(query).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    expect(query).toHaveBeenCalledTimes(1);
    // 传给真实表格的代理配置必须被合并为「启用但不自动加载」。
    const gridProps = wrapper.findComponent(VxeGrid).props('proxyConfig') as {
      autoLoad?: boolean;
      enabled?: boolean;
    };
    expect(gridProps.autoLoad).toBe(false);
    expect(gridProps.enabled).toBe(true);
    // 搜索表单值注入扩展必须已包装真实代理回调。
    const stateAjax = api.state?.gridOptions?.proxyConfig?.ajax as
      | undefined
      | { query?: unknown };
    expect(stateAjax?.query).toBeTypeOf('function');
    expect(stateAjax?.query).not.toBe(query);
    // 初始化完成后的代理查询必须走注入表单值的包装回调。
    await api.query();
    expect(query).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('表格内表单配置不受支持时给出明确警告', /** 静默忽略会让业务以为 formConfig 已生效。 */ async () => {
    const warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(
        /** 警告内容由断言读取，不向测试输出噪音。 */ () => {},
      );
    const [Grid, api] = useVbenVxeGrid({
      gridOptions: {
        columns: [{ field: 'name', title: '名称' }],
        formConfig: { enabled: true },
      },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });

    await vi.waitFor(
      /** 等待挂载后的初始化链路给出提示。 */ () => {
        expect(warn).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );

    expect(warn.mock.calls.flat().join(' ')).toContain(
      'The formConfig in the grid is not supported',
    );
    wrapper.unmount();
  });
});

describe('分隔线、标题与插槽委派', /** 这些渲染分支决定筛选区样式与业务插槽能否落地。 */ () => {
  afterEach(
    /** 恢复被替换的浏览器边界。 */ () => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  );

  it('分隔线按配置真实渲染与着色', /** 分隔线缺失或颜色丢失会让筛选区与表格粘连。 */ async () => {
    const [Plain, plainApi] = useVbenVxeGrid({
      formOptions: { schema: searchSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
      separator: true,
    });
    const plain = mount(Plain, {
      attachTo: document.body,
      props: { api: plainApi },
    });
    await vi.waitFor(
      /** 等待筛选区与分隔线渲染完成。 */ () => {
        expect(plain.find('.bg-background-deep').exists()).toBe(true);
      },
      { timeout: 3000 },
    );
    plain.unmount();

    const [Colored, coloredApi] = useVbenVxeGrid({
      formOptions: { schema: searchSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
      separator: { backgroundColor: 'rgb(1, 2, 3)' },
    });
    const colored = mount(Colored, {
      attachTo: document.body,
      props: { api: coloredApi },
    });
    await vi.waitFor(
      /** 等待着色分隔线渲染完成。 */ () => {
        expect(colored.find('.bg-background-deep').exists()).toBe(true);
      },
      { timeout: 3000 },
    );
    expect(colored.find('.bg-background-deep').attributes('style')).toContain(
      'rgb(1, 2, 3)',
    );
    colored.unmount();

    const [HidingForm, hidingApi] = useVbenVxeGrid({
      formOptions: { schema: searchSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
      separator: true,
      showSearchForm: false,
    });
    const hiding = mount(HidingForm, {
      attachTo: document.body,
      props: { api: hidingApi },
    });
    await waitForSearchForm(hiding);
    // 筛选区整体隐藏时不再渲染分隔线，避免留下一条悬空装饰线。
    expect(hiding.find('.bg-background-deep').exists()).toBe(false);
    hiding.unmount();

    const [Hidden, hiddenApi] = useVbenVxeGrid({
      formOptions: { schema: searchSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
      separator: { show: false },
    });
    const hidden = mount(Hidden, {
      attachTo: document.body,
      props: { api: hiddenApi },
    });
    await waitForSearchForm(hidden);
    expect(hidden.find('.bg-background-deep').exists()).toBe(false);
    hidden.unmount();
  });

  it('表格标题与帮助提示按属性渲染', /** 标题不渲染会让列表缺少业务说明入口。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
      tableTitle: '业务列表',
      tableTitleHelp: '这里是帮助文本',
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });

    await vi.waitFor(
      /** 等待工具栏标题插槽渲染完成。 */ () => {
        expect(wrapper.text()).toContain('业务列表');
      },
      { timeout: 3000 },
    );
    // 帮助文案在悬浮层内，触发图标必须真实渲染出来。
    expect(wrapper.find('svg.cursor-pointer').exists()).toBe(true);
    wrapper.unmount();
  });

  it('业务插槽按前缀委派给表格与搜索表单', /** 委派失败会让页面自定义插槽内容整块丢失。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({
      formOptions: {
        schema: [
          { component: 'VbenInput', fieldName: 'extraField', label: '扩展' },
        ],
      },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
      slots: {
        /** 表格级业务插槽内容。 */
        'custom-block': /** 渲染可识别的业务插槽内容。 */ () => '自定义区块',
        /** 搜索表单级业务插槽内容，前缀必须被去掉后落到同名字段。 */
        'form-extraField': /** 渲染可识别的表单插槽内容。 */ () =>
          '表单扩展字段',
        /** 表格工具栏级业务插槽内容。 */
        'toolbar-tools': /** 渲染可识别的工具栏插槽内容。 */ () => '工具栏工具',
      },
    });
    await nextTick();
    await nextTick();
    await vi.waitFor(
      /** 等待表单字段插槽真实渲染。 */ () => {
        expect(wrapper.text()).toContain('表单扩展字段');
      },
      { timeout: 3000 },
    );

    const gridSlots = wrapper.findComponent(VxeGrid).vm.$slots;
    expect(Object.keys(gridSlots)).toContain('custom-block');
    expect(Object.keys(gridSlots)).toContain('toolbar-tools');

    const form = wrapper.findComponent({ name: 'VbenUseForm' });
    expect(Object.keys(form.vm.$slots)).toContain('extraField');
    wrapper.unmount();
  });

  it('没有列定义时不再追加序号列', /** 未配置列定义时追加序号列会渲染出无意义的表格列。 */ async () => {
    const [Grid, api] = useVbenVxeGrid({
      gridOptions: { data: [{ name: '研发部' }] },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });

    await nextTick();
    await nextTick();

    expect(wrapper.find('.vxe-grid').exists()).toBe(true);
    expect(api.state?.gridOptions?.columns).toBeUndefined();
    wrapper.unmount();
  });
});

describe('栅格列数与展开按钮', /** 栅格列数决定搜索表单是否需要展开按钮。 */ () => {
  afterEach(
    /** 恢复被替换的媒体查询边界。 */ () => {
      vi.unstubAllGlobals();
    },
  );

  it('列数足够时不再渲染展开按钮', /** 多渲染展开按钮会让筛选区出现无意义的收起入口。 */ async () => {
    stubViewportWidth(1600);
    const [Grid, api] = useVbenVxeGrid({
      formOptions: { schema: twoFieldSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });
    await waitForSearchForm(wrapper);

    expect(wrapper.find('.vben-link').exists()).toBe(false);
    wrapper.unmount();
  });

  it('显式关闭折叠按钮时即使放不下也不渲染', /** 业务显式关闭的折叠入口不能被自动判定重新打开。 */ async () => {
    stubViewportWidth(480);
    const [Grid, api] = useVbenVxeGrid({
      formOptions: { schema: searchSchema, showCollapseButton: false },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });
    await waitForSearchForm(wrapper);

    expect(wrapper.find('.vben-link').exists()).toBe(false);
    wrapper.unmount();
  });

  it('中等屏幕放不下时渲染展开按钮', /** 放不下却不出展开按钮会让筛选字段被永久隐藏。 */ async () => {
    stubViewportWidth(800);
    const [Grid, api] = useVbenVxeGrid({
      formOptions: { schema: twoFieldSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });
    await vi.waitFor(
      /** 等待展开按钮渲染完成。 */ () => {
        expect(wrapper.find('.vben-link').exists()).toBe(true);
      },
      { timeout: 3000 },
    );

    wrapper.unmount();
  });

  it('窄屏只保留单列并显示展开按钮', /** 单列栅格下字段必然被折叠，展开按钮必须出现。 */ async () => {
    stubViewportWidth(480);
    const [Grid, api] = useVbenVxeGrid({
      formOptions: { schema: searchSchema },
      gridOptions: { columns: [{ field: 'name', title: '名称' }], data: [] },
    });
    const wrapper = mount(Grid, {
      attachTo: document.body,
      props: { api },
    });
    await vi.waitFor(
      /** 等待展开按钮渲染完成。 */ () => {
        expect(wrapper.find('.vben-link').exists()).toBe(true);
      },
      { timeout: 3000 },
    );

    wrapper.unmount();
  });
});

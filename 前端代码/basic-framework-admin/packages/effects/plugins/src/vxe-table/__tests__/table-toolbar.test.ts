/**
 * vxe 原生列表工具栏（table-toolbar）真实行为回归。
 *
 * 该组件是 vxe 原生表格的工具栏二次封装：前缀区域提供「隐藏/显示搜索栏」「刷新」「全屏」三个
 * 操作，并把自身实例通过 getToolbarRef 交给 useTableToolbar 与表格连接。搜索回传值写反会让
 * 搜索栏状态与按钮显示相反；刷新没接上刷新入口会让用户点刷新毫无反应；全屏按钮失效会让用户
 * 无法收起头部与侧边栏；实例交不出去会让工具栏按钮不再跟随表格。用例挂载真实组件与真实 vxe
 * 工具栏，只替换远程 Iconify 图标与应用级刷新入口这两个本包无法装配的边界。
 */
import type { VueWrapper } from '@vue/test-utils';

import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { usePreferences } from '@vben/preferences';

import { useVbenForm } from '@vben-core/form-ui';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import { setupVbenVxeTable } from '../init';
import TableToolbar from '../table-toolbar.vue';

const { refreshSpy } = vi.hoisted(
  /** 提升刷新入口替身，供模块工厂与用例共享同一份调用记录。 */ () => ({
    refreshSpy: vi.fn(),
  }),
);

// 远程 Iconify 图标属外部边界：用例不联网取图，只用轻量替身占位，不影响按钮行为。
vi.mock(
  '@vben/icons',
  /** 用空元素替身代替远程图标，避免用例真实发起图标请求。 */ () => ({
    IconifyIcon: 'span',
  }),
);

// 本包没有 Pinia、路由与标签页 store 依赖，应用级刷新链路无法在这里装配；因此只把
// 「刷新入口」换成记录调用的替身，组件自身的按钮接线仍真实执行，其余 hooks 保持真实实现。
vi.mock(
  '@vben/hooks',
  /** 替换应用级刷新入口，最大化等其余能力保持真实实现。 */ async (
    importOriginal,
  ) => ({
    ...(await importOriginal<typeof import('@vben/hooks')>()),
    /** 交出记录调用的刷新入口，用于验证按钮真实接线。 */
    useRefresh: () => ({
      refresh: refreshSpy,
    }),
  }),
);

beforeAll(
  /** 工具栏依赖 vxe 全局组件注册，先按真实启动顺序完成初始化。 */ () => {
    setupVbenVxeTable({
      /** 本用例不注入应用级表格配置，只验证初始化契约。 */ configVxeTable:
        () => {},
      useVbenForm,
    });
  },
);

/**
 * 挂载列表工具栏并等待真实 vxe 工具栏渲染完成。
 * @param hiddenSearch 传入的搜索栏隐藏状态。
 * @returns 已挂载的组件包装器。
 */
async function mountToolbar(hiddenSearch: boolean) {
  const wrapper = mount(TableToolbar, {
    attachTo: document.body,
    props: { hiddenSearch },
    slots: {
      /** 前缀区域的业务插槽内容，必须与三个内置按钮一起渲染。 */
      default: /** 渲染可识别的业务插槽内容。 */ () => '工具栏业务插槽',
    },
  });
  await nextTick();
  return wrapper;
}

/**
 * 按模板顺序取出前缀区域的三个操作按钮。
 * @param wrapper 已挂载的工具栏包装器。
 * @returns 依次对应搜索、刷新、全屏的按钮包装器。
 * @throws Error 操作按钮没有全部渲染时抛出，避免用例在空节点上静默通过。
 */
function actionButtons(wrapper: VueWrapper) {
  const buttons = wrapper.findAll('button');
  const [search, refresh, fullscreen] = buttons;
  if (!search || !refresh || !fullscreen) {
    throw new Error(`工具栏操作按钮没有全部渲染，实际 ${buttons.length} 个`);
  }
  return { fullscreen, refresh, search };
}

describe('工具栏前缀区域渲染', /** 插槽与三个操作按钮缺一都会让列表页失去工具栏入口。 */ () => {
  it('业务插槽与三个操作按钮一起渲染', /** 插槽丢失或按钮缺失会让页面无法接入自定义工具或刷新。 */ async () => {
    const wrapper = await mountToolbar(false);

    expect(wrapper.text()).toContain('工具栏业务插槽');
    expect(actionButtons(wrapper)).toBeDefined();
    wrapper.unmount();
  });

  it('交回真实 vxe 工具栏实例', /** 实例取不到会让 useTableToolbar 无法把工具栏连到表格。 */ async () => {
    const wrapper = await mountToolbar(false);
    // defineExpose 暴露的取值入口，useTableToolbar 依赖它拿到工具栏实例。
    const exposed = wrapper.vm as unknown as {
      /** 取出工具栏实例的公开入口。 */
      getToolbarRef: () => undefined | { getRefMaps?: unknown };
    };

    const toolbar = exposed.getToolbarRef();

    expect(toolbar).toBeTruthy();
    // getRefMaps 是真实 vxe 工具栏实例的公开成员，用它证明拿到的不是空壳。
    expect(toolbar?.getRefMaps).toBeTypeOf('function');
    wrapper.unmount();
  });
});

describe('工具栏操作按钮行为', /** 三个按钮分别决定搜索栏、标签页刷新与全屏状态。 */ () => {
  it('点击搜索按钮回传取反后的隐藏状态', /** 回传值写反会让搜索栏状态与按钮显示相反。 */ async () => {
    const hidden = await mountToolbar(true);
    await actionButtons(hidden).search.trigger('click');
    expect(hidden.emitted('update:hiddenSearch')).toEqual([[false]]);
    hidden.unmount();

    const shown = await mountToolbar(false);
    await actionButtons(shown).search.trigger('click');
    expect(shown.emitted('update:hiddenSearch')).toEqual([[true]]);
    shown.unmount();
  });

  it('点击刷新按钮调用刷新入口', /** 按钮没接上刷新入口会让用户点刷新没有任何反应。 */ async () => {
    const wrapper = await mountToolbar(false);
    refreshSpy.mockClear();

    await actionButtons(wrapper).refresh.trigger('click');

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('点击全屏按钮在最大化与还原之间切换', /** 全屏按钮失效会让用户无法收起头部与侧边栏。 */ async () => {
    const wrapper = await mountToolbar(false);
    const { contentIsMaximize } = usePreferences();
    const before = contentIsMaximize.value;

    await actionButtons(wrapper).fullscreen.trigger('click');
    expect(contentIsMaximize.value).toBe(!before);

    // 再点一次必须回到原状态，不能把布局偏好卡在最大化。
    await actionButtons(wrapper).fullscreen.trigger('click');
    expect(contentIsMaximize.value).toBe(before);
    wrapper.unmount();
  });
});

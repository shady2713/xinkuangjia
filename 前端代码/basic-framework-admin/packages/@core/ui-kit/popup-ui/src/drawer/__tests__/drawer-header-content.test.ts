/**
 * 抽屉标题、说明与无头部（popup-ui 的 drawer.vue）真实渲染回归。
 *
 * 头部是业务抽屉的说明区域：未传标题或说明插槽时必须回退到 title/description 属性，否则抽屉
 * 顶部空白、用户不知道自己在编辑什么；titleTooltip 的说明气泡漏渲染会让危险操作缺少解释；
 * 显式关闭头部时仍要补上无障碍隐藏标题，否则读屏软件读不出抽屉名称。用例按业务侧用法挂载
 * useVbenDrawer 返回的真实组件，抽屉内容会传送到 body，因此断言读取真实文档节点。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { DrawerApiOptions, ExtendedDrawerApi } from '../drawer';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
  VisuallyHidden,
} from '@vben-core/shadcn-ui';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVbenDrawer } from '../use-drawer';

/** 本文件已挂载的宿主包装器，用例结束后统一卸载以清理传送节点与关闭兜底定时器。 */
const mountedWrappers: VueWrapper[] = [];

/** 记录挂载结果：命令式抽屉 API 与宿主包装器。 */
interface DrawerHarness {
  /** 命令式抽屉 API，用于驱动打开与关闭。 */
  api: ExtendedDrawerApi;
  /** 宿主组件包装器，用于查找传送前的真实子组件。 */
  wrapper: VueWrapper;
}

/**
 * 按业务侧用法挂载抽屉并打开。
 * @param options 传给 useVbenDrawer 的初始抽屉配置。
 * @returns 抽屉 API 与宿主包装器。
 * @throws Error 组件未在 setup 中交出 API 时抛出，避免用例静默地什么都不验证。
 */
async function mountOpenedDrawer(
  options: DrawerApiOptions = {},
): Promise<DrawerHarness> {
  const captured: { api?: ExtendedDrawerApi } = {};
  const Host = defineComponent({
    name: 'DrawerHeaderContentHost',
    /** 用真实 useVbenDrawer 建立抽屉组件与命令式 API，并把 API 交给用例驱动。
     * @returns 渲染抽屉组件的渲染函数。
     */
    setup() {
      const [Drawer, drawerApi] = useVbenDrawer(options);
      captured.api = drawerApi;
      return /** 渲染真实抽屉组件。 */ () => h(Drawer);
    },
  });

  const wrapper = mount(Host) as VueWrapper;
  mountedWrappers.push(wrapper);
  await nextTick();
  const api = captured.api;
  if (!api) {
    throw new Error('抽屉组件未在 setup 中交出 API');
  }
  api.open();
  await nextTick();
  await nextTick();

  return { api, wrapper };
}

afterEach(
  /** 卸载本文件挂载的全部抽屉并清理传送节点，避免残留定时器与节点影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  },
);

describe('抽屉标题与说明默认文案', /** 默认文案缺失会让抽屉顶部空白，用户无法确认操作对象。 */ () => {
  it('未提供插槽时按属性渲染标题与说明', /** 回退分支失效会让业务传入的文案整体丢失。 */ async () => {
    const { wrapper } = await mountOpenedDrawer({
      description: 'DUMMY-说明文案',
      title: 'DUMMY-标题文案',
    });

    expect(wrapper.getComponent(SheetTitle).text()).toContain('DUMMY-标题文案');
    expect(wrapper.getComponent(SheetDescription).text()).toBe(
      'DUMMY-说明文案',
    );
  });

  it('同时声明标题与说明时不渲染无障碍隐藏标题', /** 负对照：可见标题已存在时不应再补一套隐藏标题。 */ async () => {
    const { wrapper } = await mountOpenedDrawer({
      description: 'DUMMY-说明文案',
      title: 'DUMMY-标题文案',
    });

    expect(wrapper.findComponent(VisuallyHidden).exists()).toBe(false);
  });
});

describe('抽屉标题提示气泡', /** 提示气泡解释标题背后的影响范围，漏渲染会让危险操作缺少说明。 */ () => {
  it('悬停说明入口时渲染出真实提示文案', /** 提示内容未落地会让说明入口悬停后没有任何反应。 */ async () => {
    const { wrapper } = await mountOpenedDrawer({
      title: 'DUMMY-标题文案',
      titleTooltip: 'DUMMY-标题提示',
    });

    const trigger = wrapper
      .getComponent(SheetTitle)
      .find('.lucide-circle-question-mark');
    expect(trigger.exists()).toBe(true);
    await trigger.trigger('pointermove');

    await vi.waitFor(
      /** 等待提示面板真实渲染出说明文案。 */ () => {
        expect(document.body.textContent).toContain('DUMMY-标题提示');
      },
      { timeout: 2000 },
    );
  });

  it('未声明提示文案时不渲染说明入口', /** 负对照：没有说明却渲染图标会让用户误以为有额外解释。 */ async () => {
    const { wrapper } = await mountOpenedDrawer({ title: 'DUMMY-标题文案' });

    expect(
      wrapper
        .getComponent(SheetTitle)
        .find('.lucide-circle-question-mark')
        .exists(),
    ).toBe(false);
  });
});

describe('抽屉关闭头部', /** 全屏内容类抽屉需要去掉头部，判定失效会让页面顶部多出一整条空白。 */ () => {
  it('关闭头部时不渲染头部并补齐无障碍隐藏标题', /** 关闭头部后缺少隐藏标题会让抽屉没有可访问名称。 */ async () => {
    const { wrapper } = await mountOpenedDrawer({ header: false });

    expect(wrapper.findComponent(SheetHeader).exists()).toBe(false);
    const hidden = wrapper.findComponent(VisuallyHidden);
    expect(hidden.exists()).toBe(true);
    expect(hidden.findComponent(SheetTitle).exists()).toBe(true);
    expect(hidden.findComponent(SheetDescription).exists()).toBe(true);
  });
});

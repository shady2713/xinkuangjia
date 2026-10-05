/**
 * 标签页视图（tabs-ui 的 tabs-view）渲染与滚动交互真实回归。
 *
 * 视图决定标签栏用哪种风格渲染（chrome 风格与普通风格的分支写错会让标签栏样式整体错位），
 * 并负责把滚轮、左右滚动按钮与滚动位置状态接到真实滚动容器上：滚轮未拦截会让页面跟着滚动，
 * 按钮点击不滚动会让被挤出的标签无法访问，滚动位置状态不更新会让按钮样式与可用性判断失真。
 * 用例挂载真实视图与真实标签组件，只把浏览器布局尺寸换成确定值，因为 happy-dom 不实现排版。
 */
import type { TabDefinition } from '@vben-core/typings';

import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { VbenScrollbar } from '@vben-core/shadcn-ui';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tabs, TabsChrome } from '../components';
import TabsView from '../tabs-view.vue';

/** 本文件已挂载的宿主包装器，用例结束后统一卸载以断开观察者与拖拽实例。 */
const mountedWrappers: ReturnType<typeof mount>[] = [];

/** 两个页签：一个激活项与一个普通项，覆盖激活态与关闭态渲染。 */
const tabs = [
  {
    fullPath: '/home',
    key: 'home',
    meta: { title: 'DUMMY-首页' },
    name: 'home',
    path: '/home',
  },
  {
    fullPath: '/user',
    key: 'user',
    meta: { title: 'DUMMY-用户管理' },
    name: 'user',
    path: '/user',
  },
] as unknown as TabDefinition[];

/**
 * 挂载真实标签页视图并记录宿主，供用例结束后统一卸载。
 * @param props 透传给视图的属性，缺省使用 chrome 风格与激活首页。
 * @returns 已挂载的组件包装器。
 */
function mountTabsView(props: Record<string, unknown> = {}) {
  const wrapper = mount(TabsView, {
    // 滚轮拦截依赖真实文档层级：只有挂到文档上才能观察事件是否真的被阻断。
    attachTo: document.body,
    props: {
      active: 'home',
      styleType: 'chrome',
      tabs,
      ...props,
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

/**
 * 读取滚动容器外层包装节点，用于核对风格相关的内联类名。
 * @param wrapper 已挂载的视图包装器。
 * @returns 承载滚动容器的外层 div。
 * @throws Error 滚动容器未渲染时抛出，避免断言落到 undefined。
 */
function readScrollWrapper(wrapper: ReturnType<typeof mount>) {
  const parent = wrapper.findComponent(VbenScrollbar).element.parentElement;
  if (!parent) {
    throw new Error('滚动容器外层节点未渲染');
  }
  return parent;
}

/**
 * 读取左右滚动按钮节点。
 * @param wrapper 已挂载的视图包装器。
 * @returns 左按钮与右按钮元素，顺序与模板一致。
 * @throws Error 按钮数量不为两个时抛出，避免按错误下标断言。
 */
function readScrollButtons(wrapper: ReturnType<typeof mount>) {
  const buttons = [...wrapper.element.children].filter(
    /** 只保留模板里的左右滚动按钮节点。 */ (node) =>
      node instanceof HTMLElement && node.tagName === 'SPAN',
  );
  if (buttons.length !== 2) {
    throw new Error(`滚动按钮数量异常：${buttons.length}`);
  }
  return { left: buttons[0] as HTMLElement, right: buttons[1] as HTMLElement };
}

afterEach(
  /** 卸载视图、清理传送节点并还原被替换的布局边界，避免影响后续用例。 */ () => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  },
);

describe('标签栏风格渲染', /** 风格分支决定标签栏使用哪套外观，走错分支会让整条标签栏样式错位。 */ () => {
  it('chrome 风格渲染 chrome 标签并保留顶部内边距', /** chrome 分支走错会让标签栏失去圆角与分隔样式。 */ () => {
    const wrapper = mountTabsView({ styleType: 'chrome' });

    expect(wrapper.findComponent(TabsChrome).exists()).toBe(true);
    expect(wrapper.findComponent(Tabs).exists()).toBe(false);
    expect(wrapper.find('.tabs-chrome').exists()).toBe(true);
    expect(readScrollWrapper(wrapper).classList.contains('pt-[3px]')).toBe(
      true,
    );
    expect(wrapper.text()).toContain('DUMMY-首页');
  });

  it('普通风格渲染基础标签且不带 chrome 内边距', /** 非 chrome 分支走错会让普通标签栏被 chrome 样式污染。 */ () => {
    const wrapper = mountTabsView({ styleType: 'plain' });

    expect(wrapper.findComponent(TabsChrome).exists()).toBe(false);
    expect(wrapper.findComponent(Tabs).exists()).toBe(true);
    expect(readScrollWrapper(wrapper).classList.contains('pt-[3px]')).toBe(
      false,
    );
  });
});

describe('标签栏滚轮拦截', /** 滚轮拦截决定横向滚动标签时页面是否跟着滚动，判错会让整页跳动。 */ () => {
  it('开启滚轮响应时阻止默认行为并阻断冒泡', /** 未拦截会让页面在滚动标签时同时纵向滚动。 */ () => {
    const wrapper = mountTabsView({ wheelable: true });
    const parentSpy = vi.fn();
    document.body.addEventListener(
      'wheel',
      /** 记录冒泡到页面层的滚轮事件，用于核对事件是否被阻断。 */ parentSpy,
    );

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    wrapper.findComponent(VbenScrollbar).element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it('关闭滚轮响应时放行默认行为与冒泡', /** 负对照：关闭开关后不得再吞掉滚轮事件。 */ () => {
    const wrapper = mountTabsView({ wheelable: false });
    const parentSpy = vi.fn();
    document.body.addEventListener(
      'wheel',
      /** 记录冒泡到页面层的滚轮事件，用于核对事件被放行。 */ parentSpy,
    );

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 120,
    });
    wrapper.findComponent(VbenScrollbar).element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(parentSpy).toHaveBeenCalledTimes(1);
  });
});

describe('标签栏滚动按钮', /** 滚动按钮是被挤出标签的唯一入口，不显示或不滚动都会让标签无法访问。 */ () => {
  it('内容溢出时显示按钮并驱动真实横向滚动', /** 按钮点击不滚动会让用户看不到被挤出的标签。 */ async () => {
    // happy-dom 不实现排版：这里替换布局尺寸边界，给出确定的容器宽度与内容宽度。
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300);
    const scrollBy = vi
      .spyOn(Element.prototype, 'scrollBy')
      .mockImplementation(/** 屏蔽真实滚动，只保留调用记录。 */ () => {});

    const wrapper = mountTabsView();
    await flushPromises();
    await nextTick();

    const buttons = readScrollButtons(wrapper);
    expect(buttons.left.style.display).not.toBe('none');
    expect(buttons.right.style.display).not.toBe('none');

    buttons.left.click();
    await nextTick();
    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', left: 50 });

    buttons.right.click();
    await nextTick();
    expect(scrollBy).toHaveBeenCalledWith({ behavior: 'smooth', left: -50 });
  });

  it('内容未溢出时按钮隐藏且点击不滚动', /** 负对照：无溢出仍显示按钮或滚动会让标签栏出现空白位移。 */ async () => {
    // happy-dom 默认布局尺寸为 0，正好代表内容未溢出。
    const scrollBy = vi
      .spyOn(Element.prototype, 'scrollBy')
      .mockImplementation(/** 屏蔽真实滚动，只保留调用记录。 */ () => {});

    const wrapper = mountTabsView();
    await flushPromises();
    await nextTick();

    const buttons = readScrollButtons(wrapper);
    expect(buttons.left.style.display).toBe('none');
    expect(buttons.right.style.display).toBe('none');

    buttons.left.click();
    buttons.right.click();
    await nextTick();
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('标签栏滚动位置状态', /** 位置状态决定按钮的可用性样式，不更新会让按钮一直显示为不可点。 */ () => {
  it('收到滚动位置事件后更新两侧按钮样式', /** 状态未更新会让已经能滚动的方向仍然显示为禁用。 */ async () => {
    // 只接管计时器以推进滚动状态的防抖窗口，保留真实时钟避免事件时间戳被冻结。
    vi.useFakeTimers({ toFake: ['clearTimeout', 'setTimeout'] });
    const wrapper = mountTabsView();
    await nextTick();

    const buttons = readScrollButtons(wrapper);
    expect(buttons.left.classList.contains('pointer-events-none')).toBe(true);

    wrapper.findComponent(VbenScrollbar).vm.$emit('scrollAt', {
      bottom: true,
      left: false,
      right: true,
      top: true,
    });
    vi.advanceTimersByTime(150);
    await nextTick();

    expect(buttons.left.classList.contains('cursor-pointer')).toBe(true);
    expect(buttons.left.classList.contains('pointer-events-none')).toBe(false);
    expect(buttons.right.classList.contains('pointer-events-none')).toBe(true);
  });
});

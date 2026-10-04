/**
 * 标签页横向滚动 composable（tabs-ui 的 use-tabs-view-scroll）真实行为回归。
 *
 * 标签栏内容超出宽度时由它决定左右滚动按钮是否出现、点击滚动多少、滚轮与滚动位置
 * 状态如何更新：视口解析写错会让按钮永远不出现或永远不消失；溢出判定符号写反会让
 * 按钮在内容不足时出现；滚动距离算错会让一次点击跳过多个标签；激活标签不在可视区时
 * 不滚动会让用户切换后看不到当前标签；卸载不断开观察者会在标签栏销毁后继续回调。
 * 用例用真实 DOM 层级、真实尺寸读取与可手动触发的观察者替身驱动，只替换第三方
 * 滚动容器实例与浏览器观察者。
 */
import type { TabDefinition } from '@vben-core/typings';

import type { TabsProps } from './types';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, reactive } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTabsViewScroll } from './use-tabs-view-scroll';

/** 被测 composable 返回的接口，供用例在挂载后直接驱动。 */
type ScrollApi = ReturnType<typeof useTabsViewScroll>;

/** 观察者回调签名：参数与本替身无关，用例只负责触发回调。 */
type ObserverCallback = (...args: never[]) => void;

/** 观察者替身的共享记录：回调、观察目标与观察参数。 */
interface ObserverProbe {
  /** 实例化时收到的回调；用例直接调用以模拟观察到的变化。 */
  callbacks: ObserverCallback[];
  /** 断开次数，用例据此核对重建与卸载清理。 */
  disconnected: number;
  /** 被观察的元素。 */
  observed: Element[];
  /** observe 收到的配置参数。 */
  options: unknown[];
}

/**
 * 建立一个空的观察者记录。
 * @returns 所有计数与集合均为空的记录。
 */
function createObserverProbe(): ObserverProbe {
  return { callbacks: [], disconnected: 0, observed: [], options: [] };
}

/** 尺寸变化观察者替身：记录回调与观察目标，供用例手动触发。 */
class ResizeObserverStub {
  /** 全部实例共享的记录；每个用例开始前重置。 */
  static probe: ObserverProbe = createObserverProbe();

  /**
   * 登记尺寸变化回调。
   * @param callback 尺寸变化回调。
   */
  constructor(callback: ResizeObserverCallback) {
    ResizeObserverStub.probe.callbacks.push(
      callback as unknown as ObserverCallback,
    );
  }

  /** 记录一次断开，用例据此核对卸载清理。 */
  disconnect() {
    ResizeObserverStub.probe.disconnected += 1;
  }

  /**
   * 记录被观察的元素。
   * @param target 被观察元素。
   */
  observe(target: Element) {
    ResizeObserverStub.probe.observed.push(target);
  }

  /** 取消观察；本替身不区分单个目标，直接复用断开记录。 */
  unobserve() {}
}

/** 子节点变化观察者替身：记录回调与参数，供用例手动触发。 */
class MutationObserverStub {
  /** 全部实例共享的记录；每个用例开始前重置。 */
  static probe: ObserverProbe = createObserverProbe();

  /**
   * 登记子节点变化回调。
   * @param callback 子节点变化回调。
   */
  constructor(callback: MutationCallback) {
    MutationObserverStub.probe.callbacks.push(
      callback as unknown as ObserverCallback,
    );
  }

  /** 记录一次断开，用例据此核对重建与卸载清理。 */
  disconnect() {
    MutationObserverStub.probe.disconnected += 1;
  }

  /**
   * 记录被观察的元素与配置。
   * @param target 被观察元素。
   * @param options 观察配置。
   */
  observe(target: Element, options?: MutationObserverInit) {
    MutationObserverStub.probe.observed.push(target);
    MutationObserverStub.probe.options.push(options);
  }

  /**
   * 取出已入队的变更记录；本替身不产生记录。
   * @returns 始终为空数组，用例不需要处理变更队列。
   */
  takeRecords() {
    return [];
  }
}

/** 滚动区域夹具：真实 DOM 层级、可控尺寸与滚动调用记录。 */
interface ScrollFixture {
  /** 激活标签元素，记录 scrollIntoView 调用。 */
  activeItem: HTMLElement;
  /** 滚动条根元素，对应真实滚动容器组件的 $el。 */
  scrollbarEl: HTMLElement;
  /** 视口的 scrollBy 调用记录。 */
  scrollBy: ReturnType<typeof vi.fn>;
  /** 激活标签的 scrollIntoView 调用记录。 */
  scrollIntoView: ReturnType<typeof vi.fn>;
  /** 视口元素，尺寸由用例控制。 */
  viewport: HTMLElement;
}

/** 用例创建并挂到文档流的元素，用例结束后统一移除，避免跨用例串扰。 */
const createdElements: HTMLElement[] = [];

beforeEach(
  /** 启用假定时器、重置观察者记录并隔离浏览器观察者实现。 */ () => {
    vi.useFakeTimers({
      toFake: [
        'cancelAnimationFrame',
        'clearTimeout',
        'requestAnimationFrame',
        'setTimeout',
      ],
    });
    ResizeObserverStub.probe = createObserverProbe();
    MutationObserverStub.probe = createObserverProbe();
    vi.stubGlobal('MutationObserver', MutationObserverStub);
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    createdElements.length = 0;
  },
);

afterEach(
  /** 恢复真实时钟与全局对象，并移除本用例创建的元素。 */ () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const element of createdElements) {
      element.remove();
    }
    createdElements.length = 0;
  },
);

/**
 * 在真实元素上写入布局尺寸；happy-dom 默认只提供只读的 0。
 * @param element 目标元素。
 * @param property 要覆盖的尺寸属性名。
 * @param value 尺寸像素值。
 */
function setLength(
  element: Element,
  property: 'clientWidth' | 'scrollWidth',
  value: number,
) {
  Object.defineProperty(element, property, { configurable: true, value });
}

/**
 * 在元素上挂载可断言的滚动方法替身。
 * @param element 目标元素。
 * @param name 方法名。
 * @returns 记录调用的方法替身。
 */
function mockMethod(element: Element, name: 'scrollBy' | 'scrollIntoView') {
  const method = vi.fn();
  Object.defineProperty(element, name, { configurable: true, value: method });
  return method;
}

/**
 * 建立带真实 DOM 层级与可控尺寸的滚动区域。
 * @param sizes 滚动区域的尺寸配置。
 * @param sizes.scrollbarWidth 滚动条根元素的可见宽度。
 * @param sizes.scrollViewWidth 视口的可见宽度。
 * @param sizes.scrollWidth 视口的内容宽度，超过可见宽度即视为溢出。
 * @returns 滚动区域夹具。
 */
function createScrollFixture(sizes: {
  scrollbarWidth: number;
  scrollViewWidth: number;
  scrollWidth: number;
}): ScrollFixture {
  const scrollbarEl = document.createElement('div');
  setLength(scrollbarEl, 'clientWidth', sizes.scrollbarWidth);
  const viewport = document.createElement('div');
  viewport.dataset.rekaScrollAreaViewport = 'true';
  setLength(viewport, 'clientWidth', sizes.scrollViewWidth);
  setLength(viewport, 'scrollWidth', sizes.scrollWidth);
  const activeItem = document.createElement('div');
  activeItem.className = 'is-active';
  activeItem.dataset.tabItem = 'true';
  const idleItem = document.createElement('div');
  idleItem.dataset.tabItem = 'true';
  viewport.append(activeItem, idleItem);
  scrollbarEl.append(viewport);
  document.body.append(scrollbarEl);
  createdElements.push(scrollbarEl);
  const scrollBy = mockMethod(viewport, 'scrollBy');
  const scrollIntoView = mockMethod(activeItem, 'scrollIntoView');
  return { activeItem, scrollBy, scrollbarEl, scrollIntoView, viewport };
}

/**
 * 建立可被用例改写的标签页属性。
 * @param tabs 初始标签集合的 key 列表。
 * @returns 响应式标签页属性。
 */
function createProps(tabs: string[]): TabsProps {
  return reactive<TabsProps>({
    active: tabs[0],
    styleType: 'chrome',
    tabs: tabs.map(
      /** 只保留被测逻辑读取的 key，其余路由字段与本断言无关。 */ (key) =>
        ({ key }) as TabDefinition,
    ),
  });
}

/**
 * 挂载真实调用 useTabsViewScroll 的宿主组件。
 * @param props 传给 composable 的标签页属性。
 * @returns 宿主包装器与 composable 接口。
 */
function mountScroll(props: TabsProps) {
  /** 承接 setup 中同步取到的 composable 接口。 */
  const holder: { api?: ScrollApi } = {};
  const wrapper = mount(
    defineComponent({
      /**
       * 调用被测 composable 并渲染宿主节点。
       * @returns 渲染占位宿主节点的渲染函数。
       */
      setup() {
        holder.api = useTabsViewScroll(props);
        return /** 渲染占位宿主节点，真实滚动区域由用例单独建立。 */ () =>
          h('div', { class: 'scroll-host' });
      },
    }),
  );
  const api = holder.api;
  if (!api) {
    throw new Error('宿主组件未暴露滚动接口');
  }
  return { api, wrapper };
}

/**
 * 把真实滚动容器交给 composable 的滚动条引用，模拟子组件挂载后的 ref 绑定。
 * @param api 被测 composable 接口。
 * @param scrollbarEl 作为滚动条根元素的真实元素。
 */
function attachScrollbar(api: ScrollApi, scrollbarEl: HTMLElement) {
  api.scrollbarRef.value = { $el: scrollbarEl } as never;
}

/**
 * 等待初始化链路上的响应式更新完成。
 * @param rounds 需要等待的 nextTick 轮数，覆盖初始化中的多次 await。
 */
async function settle(rounds = 6) {
  for (let index = 0; index < rounds; index++) {
    await nextTick();
  }
}

/**
 * 触发尺寸变化观察者并按防抖窗口推进时钟。
 * @param probe 观察者记录，取最近一次注册的回调。
 */
async function triggerResize(probe: ObserverProbe) {
  probe.callbacks.at(-1)?.();
  vi.advanceTimersByTime(100);
  await settle();
}

/**
 * 推进动画帧时钟，执行 scrollIntoView 所在的回调。
 * @param milliseconds 推进的毫秒数，默认覆盖一帧。
 */
async function flushAnimationFrame(milliseconds = 20) {
  vi.advanceTimersByTime(milliseconds);
  await settle();
}

describe('滚动视口解析', /** 视口与尺寸是按钮显隐与滚动距离的唯一数据来源。 */ () => {
  it('挂载后解析真实视口并观察它的尺寸与子节点', /** 不解析视口会让滚动按钮与自动滚动全部失效。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 300,
    });
    const props = createProps(['tab-1']);
    const { api } = mountScroll(props);
    attachScrollbar(api, fixture.scrollbarEl);

    await settle();

    expect(ResizeObserverStub.probe.observed).toEqual([fixture.viewport]);
    expect(MutationObserverStub.probe.observed).toEqual([fixture.viewport]);
    expect(MutationObserverStub.probe.options).toEqual([
      { attributes: false, childList: true, subtree: true },
    ]);
  });

  it('内容未溢出时不显示滚动按钮，也不滚动激活标签', /** 溢出判定写反会让按钮在内容不足时出现。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 300,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);

    await settle();
    await flushAnimationFrame();

    expect(api.showScrollButton.value).toBe(false);
    expect(fixture.scrollIntoView).not.toHaveBeenCalled();
  });

  it('内容溢出时显示滚动按钮', /** 内容被裁掉却没有按钮会让用户永远看不到后续标签。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 600,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);

    await settle();

    expect(api.showScrollButton.value).toBe(true);
  });

  it('滚动条未就绪时初始化提前返回且不创建观察者', /** 未就绪仍创建观察者会在空目标上抛出异常。 */ async () => {
    const { api } = mountScroll(createProps(['tab-1']));

    await settle();

    expect(api.showScrollButton.value).toBe(false);
    expect(ResizeObserverStub.probe.callbacks).toHaveLength(0);
    expect(MutationObserverStub.probe.callbacks).toHaveLength(0);
    // 视口未解析时滚动指令必须安全返回，不能因取不到尺寸而抛错。
    api.scrollDirection('left');
    api.handleWheel({ deltaY: 40 } as WheelEvent);
  });

  it('滚动容器内没有真实视口时保持不显示滚动按钮', /** 容器结构变化时读取空视口会让计算抛错。 */ async () => {
    const scrollbarEl = document.createElement('div');
    document.body.append(scrollbarEl);
    createdElements.push(scrollbarEl);
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, scrollbarEl);

    await settle();
    await triggerResize(ResizeObserverStub.probe);

    expect(api.showScrollButton.value).toBe(false);
    expect(ResizeObserverStub.probe.observed).toEqual([null]);
  });
});

describe('滚动按钮显隐计算', /** 尺寸与子节点变化后必须重新计算，否则按钮状态会过期。 */ () => {
  it('尺寸变化后按防抖窗口重新计算', /** 不重新计算会让内容变长后仍不显示按钮。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 300,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    setLength(fixture.viewport, 'scrollWidth', 600);
    ResizeObserverStub.probe.callbacks.at(-1)?.();

    expect(api.showScrollButton.value).toBe(false);

    vi.advanceTimersByTime(100);
    await settle();

    expect(api.showScrollButton.value).toBe(true);
  });

  it('子节点数量增加时立即重新计算', /** 新增标签后按钮不出现会让新标签落在可视区之外。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 300,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    const added = document.createElement('div');
    added.dataset.tabItem = 'true';
    fixture.viewport.append(added);
    setLength(fixture.viewport, 'scrollWidth', 600);
    MutationObserverStub.probe.callbacks.at(-1)?.();
    await settle();

    expect(api.showScrollButton.value).toBe(true);
  });

  it('子节点数量未变化时不做任何重新计算', /** 每次变更都重算会让滚动状态被无关变更反复改写。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 300,
    });
    const { api } = mountScroll(createProps(['tab-1', 'tab-2']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    setLength(fixture.viewport, 'scrollWidth', 600);
    MutationObserverStub.probe.callbacks.at(-1)?.();
    await settle();
    expect(api.showScrollButton.value).toBe(false);

    setLength(fixture.viewport, 'scrollWidth', 900);
    MutationObserverStub.probe.callbacks.at(-1)?.();
    await settle();

    expect(api.showScrollButton.value).toBe(false);
  });
});

describe('滚动距离与滚轮', /** 一次点击滚动的距离决定用户要按多少次才能找到目标标签。 */ () => {
  it('按方向滚动一个视口宽度并保留默认间距', /** 方向取反会让左右按钮行为互换。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    api.scrollDirection('left');
    api.scrollDirection('right');

    expect(fixture.scrollBy).toHaveBeenNthCalledWith(1, {
      behavior: 'smooth',
      left: -150,
    });
    expect(fixture.scrollBy).toHaveBeenNthCalledWith(2, {
      behavior: 'smooth',
      left: 150,
    });
  });

  it('自定义间距参与距离计算', /** 忽略调用方间距会让长标签一次滚动过多。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    api.scrollDirection('right', 80);

    expect(fixture.scrollBy).toHaveBeenCalledWith({
      behavior: 'smooth',
      left: 220,
    });
  });

  it('视口不可滚动时不触发滚动', /** 内容不足仍滚动会让标签栏出现空白。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 200,
      scrollWidth: 900,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    api.scrollDirection('left');

    expect(fixture.scrollBy).not.toHaveBeenCalled();
  });

  it('缺少滚动容器或视口宽度为 0 时不触发滚动', /** 未就绪时计算距离会得到 NaN 并抛出异常。 */ async () => {
    const { api } = mountScroll(createProps(['tab-1']));

    api.scrollDirection('left');

    const fixture = createScrollFixture({
      scrollbarWidth: 0,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();
    api.scrollDirection('left');

    expect(fixture.scrollBy).not.toHaveBeenCalled();
  });

  it('滚轮纵向位移按三倍换算成横向滚动', /** 换算系数丢失会让滚轮几乎滚不动标签栏。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    api.handleWheel({ deltaY: 40 } as WheelEvent);

    expect(fixture.scrollBy).toHaveBeenCalledWith({ left: 120 });
  });

  it('滚动位置状态按防抖窗口更新', /** 不防抖会让每次滚动都触发状态写入与重渲染。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    const { api } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    api.handleScrollAt({ left: false, right: true });
    expect(api.scrollIsAtLeft.value).toBe(true);
    expect(api.scrollIsAtRight.value).toBe(false);

    vi.advanceTimersByTime(100);
    await settle();

    expect(api.scrollIsAtLeft.value).toBe(false);
    expect(api.scrollIsAtRight.value).toBe(true);
  });
});

describe('激活标签可见性与重建', /** 切换标签与外观时滚动状态必须跟上，否则用户看不到当前标签。 */ () => {
  it('激活标签变化后把它滚入可视区', /** 激活标签留在可视区外会让用户不知道当前在哪一页。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    const props = createProps(['tab-1']);
    const { api } = mountScroll(props);
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();
    await flushAnimationFrame();
    const initialCalls = fixture.scrollIntoView.mock.calls.length;

    props.active = 'tab-2';
    await settle();
    await flushAnimationFrame();

    expect(fixture.scrollIntoView.mock.calls.length).toBeGreaterThan(
      initialCalls,
    );
    expect(fixture.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: 'smooth',
      inline: 'start',
    });
  });

  it('视口尚未就绪时切换激活标签不抛出异常', /** 初始化前切换标签会让启动阶段直接报错。 */ async () => {
    const props = createProps(['tab-1', 'tab-2']);
    const { api } = mountScroll(props);

    props.active = 'tab-2';
    await settle();

    expect(api.showScrollButton.value).toBe(false);
    expect(ResizeObserverStub.probe.callbacks).toHaveLength(0);
  });

  it('外观类型变化后重建观察者并断开旧实例', /** 不重建会让滚动容器替换后仍观察已移除的旧视口。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    const props = createProps(['tab-1']);
    const { api } = mountScroll(props);
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    props.styleType = 'card';
    await settle();

    expect(api.showScrollButton.value).toBe(true);
    expect(ResizeObserverStub.probe.disconnected).toBeGreaterThanOrEqual(1);
    expect(MutationObserverStub.probe.disconnected).toBeGreaterThanOrEqual(1);
    expect(ResizeObserverStub.probe.observed.length).toBeGreaterThanOrEqual(2);
  });

  it('卸载时断开两个观察者', /** 不断开会让标签栏销毁后继续收到回调并改写状态。 */ async () => {
    const fixture = createScrollFixture({
      scrollbarWidth: 300,
      scrollViewWidth: 300,
      scrollWidth: 900,
    });
    const { api, wrapper } = mountScroll(createProps(['tab-1']));
    attachScrollbar(api, fixture.scrollbarEl);
    await settle();

    wrapper.unmount();

    expect(ResizeObserverStub.probe.disconnected).toBeGreaterThanOrEqual(1);
    expect(MutationObserverStub.probe.disconnected).toBeGreaterThanOrEqual(1);
  });
});

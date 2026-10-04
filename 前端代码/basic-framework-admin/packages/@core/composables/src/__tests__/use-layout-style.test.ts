/**
 * 布局样式 composable（composables 的 use-layout-style）真实行为回归。
 *
 * 这三组 composable 把布局尺寸写进全局 CSS 变量，并让内容遮罩跟随内容区可见矩形：
 * 内容区未测量时 overlayStyle 会拿到未定义尺寸，元素未绑定或卸载后不清理观察者会
 * 让尺寸停在旧值并泄漏 ResizeObserver，头尾高度解析写错会让布局读回错误的像素值。
 * 用例在真实组件中调用 composable，只把浏览器未提供的 ResizeObserver 与元素测量
 * 结果替换为可控替身。
 */
import type { CSSProperties } from 'vue';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import {
  CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT,
  CSS_VARIABLE_LAYOUT_CONTENT_WIDTH,
  CSS_VARIABLE_LAYOUT_FOOTER_HEIGHT,
  CSS_VARIABLE_LAYOUT_HEADER_HEIGHT,
} from '@vben-core/shared/constants';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useLayoutContentStyle,
  useLayoutFooterStyle,
  useLayoutHeaderStyle,
} from '../use-layout-style';

/** 观察者回调签名；与浏览器 ResizeObserver 的回调形状一致。 */
type ResizeCallback = (
  entries: ResizeObserverEntry[],
  observer: ResizeObserver,
) => void;

/**
 * happy-dom 未提供的 ResizeObserver 替身。
 * 记录被观察元素并允许用例手动触发回调，从而在可控时刻驱动尺寸重算。
 */
class FakeResizeObserver {
  /** 全部替身实例，供用例取回最近一次建立的观察者。 */
  static instances: FakeResizeObserver[] = [];

  /** 浏览器传入的尺寸变化回调。 */
  callback: ResizeCallback;
  /** 是否已断开观察，用于验证卸载清理。 */
  disconnected = false;
  /** 被观察元素列表。 */
  observed: Element[] = [];

  /**
   * 记录回调并登记实例。
   * @param callback 浏览器传入的尺寸变化回调。
   */
  constructor(callback: ResizeCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  /**
   * 断开观察并记录状态。
   */
  disconnect() {
    this.disconnected = true;
  }

  /**
   * 记录被观察元素。
   * @param element 目标元素。
   */
  observe(element: Element) {
    this.observed.push(element);
  }

  /**
   * 取消单个元素的观察；本替身只记录，不影响用例断言。
   */
  unobserve() {}
}

/** 内容区在用例中的可见尺寸；与 getElementVisibleRect 的入参口径一致。 */
const visibleRect = {
  bottom: 110,
  height: 100,
  left: 20,
  right: 220,
  top: 10,
  width: 200,
};

/** 内容区 composable 的返回值；在真实组件 setup 中取得。 */
type ContentApi = ReturnType<typeof useLayoutContentStyle>;
/** 头尾高度 composable 的返回值；在真实组件 setup 中取得。 */
type HeaderApi = ReturnType<typeof useLayoutHeaderStyle>;
/** 页脚高度 composable 的返回值；在真实组件 setup 中取得。 */
type FooterApi = ReturnType<typeof useLayoutFooterStyle>;

/**
 * 在真实组件上下文中调用内容区 composable，并可选地绑定内容元素。
 * @param bindElement 是否把元素引用绑定到 contentElement；false 表示模板未绑定。
 * @returns 已挂载的包装器与 composable 返回值。
 */
function mountContentStyle(bindElement = true) {
  let api: ContentApi | undefined;
  const probe = defineComponent({
    /**
     * 在 setup 中取得 composable 返回值，供用例在组件外驱动。
     * @returns 渲染内容元素的函数；未绑定时渲染无 ref 的占位节点。
     */
    setup() {
      api = useLayoutContentStyle();
      return /** 渲染内容元素或未绑定占位节点。 */ () => {
        return bindElement
          ? h('div', { ref: api?.contentElement })
          : h('div', { 'data-test': 'unbound' });
      };
    },
  });
  const wrapper = mount(probe);
  if (!api) {
    throw new Error('useLayoutContentStyle 未返回可驱动的 API');
  }
  return { api, wrapper };
}

/**
 * 在真实组件上下文中调用头部高度 composable。
 * @returns composable 返回值。
 * @throws 组件 setup 未取得返回值时报告契约变化。
 */
function mountHeaderStyle(): HeaderApi {
  let api: HeaderApi | undefined;
  const probe = defineComponent({
    /**
     * 在 setup 中调用 composable。
     * @returns 不渲染节点的函数，取值本身才是观察对象。
     */
    setup() {
      api = useLayoutHeaderStyle();
      return /** 不渲染任何节点，只用于取得 composable 返回值。 */ () => null;
    },
  });
  mount(probe);
  if (!api) {
    throw new Error('useLayoutHeaderStyle 未返回可驱动的 API');
  }
  return api;
}

/**
 * 在真实组件上下文中调用页脚高度 composable。
 * @returns composable 返回值。
 * @throws 组件 setup 未取得返回值时报告契约变化。
 */
function mountFooterStyle(): FooterApi {
  let api: FooterApi | undefined;
  const probe = defineComponent({
    /**
     * 在 setup 中调用 composable。
     * @returns 不渲染节点的函数，取值本身才是观察对象。
     */
    setup() {
      api = useLayoutFooterStyle();
      return /** 不渲染任何节点，只用于取得 composable 返回值。 */ () => null;
    },
  });
  mount(probe);
  if (!api) {
    throw new Error('useLayoutFooterStyle 未返回可驱动的 API');
  }
  return api;
}

/**
 * 读取根元素上指定 CSS 变量的当前值。
 * @param name 变量名，含 `--` 前缀。
 * @returns 变量值；未设置时为空字符串。
 */
function readRootCssVar(name: string) {
  return document.documentElement.style.getPropertyValue(name);
}

beforeEach(
  /** 每例使用独立的观察者替身集合与干净的根元素样式。 */ () => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    document.documentElement.style.cssText = '';
  },
);

afterEach(
  /** 还原被替换的全局观察者，并清空本用例写入的 CSS 变量。 */ () => {
    vi.unstubAllGlobals();
    document.documentElement.style.cssText = '';
  },
);

describe('内容区尺寸跟随', /** 内容区尺寸与遮罩矩形必须随真实测量更新，否则遮罩会覆盖错误的区域。 */ () => {
  it('挂载后观察内容元素并在测量后写入尺寸变量', /** 未观察元素会让内容区尺寸停在初始值，遮罩与滚动区域错位。 */ async () => {
    const { api, wrapper } = mountContentStyle();
    await nextTick();

    const observedElement = wrapper.get('div').element;
    const observer = FakeResizeObserver.instances.at(-1);
    expect(observer).toBeDefined();
    expect(observer?.observed).toEqual([observedElement]);

    // 只替换元素测量边界：happy-dom 的布局结果恒为 0，无法证明尺寸计算。
    observedElement.getBoundingClientRect = /** 返回固定的可见矩形。 */ () =>
      visibleRect as DOMRect;

    observer?.callback([], observer as unknown as ResizeObserver);
    await vi.waitFor(
      /** 等待 16ms 防抖窗口结束后写入尺寸。 */ () => {
        expect(api.visibleDomRect.value).toEqual(visibleRect);
      },
    );

    expect(readRootCssVar(CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT)).toBe('100px');
    expect(readRootCssVar(CSS_VARIABLE_LAYOUT_CONTENT_WIDTH)).toBe('200px');
    expect(api.overlayStyle.value).toEqual({
      height: '100px',
      left: '20px',
      position: 'fixed',
      top: '10px',
      width: '200px',
      zIndex: 150,
    });
  });

  it('尚未测量时遮罩尺寸保持未定义占位', /** 未测量时给出 0 会让遮罩先闪到左上角，保留占位更符合真实契约。 */ () => {
    const { api } = mountContentStyle();

    expect(api.visibleDomRect.value).toBeNull();
    expect(api.overlayStyle.value).toEqual({
      height: 'undefinedpx',
      left: 'undefinedpx',
      position: 'fixed',
      top: 'undefinedpx',
      width: 'undefinedpx',
      zIndex: 150,
    } satisfies CSSProperties);
  });

  it('模板未绑定内容元素时不建立观察者', /** 没有目标元素时建立观察者会在后续测量中读到空元素。 */ async () => {
    mountContentStyle(false);
    await nextTick();

    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it('卸载时断开观察并清空句柄', /** 未断开的观察者会在组件销毁后继续写入全局变量。 */ async () => {
    const { wrapper } = mountContentStyle();
    await nextTick();
    const observer = FakeResizeObserver.instances.at(-1);

    wrapper.unmount();

    expect(observer?.disconnected).toBe(true);
  });
});

describe('头部与页脚高度变量', /** 头尾高度以像素字符串写入全局变量并提供反解，读写口径必须一致。 */ () => {
  it('头部高度写入后可以原值读回', /** 写入缺少 px 或反解按错误进制会让布局拿到 NaN 或错误高度。 */ async () => {
    const { getLayoutHeaderHeight, setLayoutHeaderHeight } = mountHeaderStyle();

    setLayoutHeaderHeight(64);
    // CSS 变量写入由响应式监听在下一轮刷新时落到根元素。
    await nextTick();

    expect(readRootCssVar(CSS_VARIABLE_LAYOUT_HEADER_HEIGHT)).toBe('64px');
    expect(getLayoutHeaderHeight()).toBe(64);
  });

  it('页脚高度写入后可以原值读回', /** 页脚与头部使用不同变量，写错变量会让页脚高度覆盖头部。 */ async () => {
    const { getLayoutFooterHeight, setLayoutFooterHeight } = mountFooterStyle();

    setLayoutFooterHeight(48);
    // CSS 变量写入由响应式监听在下一轮刷新时落到根元素。
    await nextTick();

    expect(readRootCssVar(CSS_VARIABLE_LAYOUT_FOOTER_HEIGHT)).toBe('48px');
    expect(getLayoutFooterHeight()).toBe(48);
  });

  it('头部与页脚互不覆盖对方的变量', /** 两个 composable 共用同一变量时头尾会互相改写。 */ async () => {
    const header = mountHeaderStyle();
    const footer = mountFooterStyle();

    header.setLayoutHeaderHeight(56);
    footer.setLayoutFooterHeight(32);
    await nextTick();

    expect(readRootCssVar(CSS_VARIABLE_LAYOUT_HEADER_HEIGHT)).toBe('56px');
    expect(readRootCssVar(CSS_VARIABLE_LAYOUT_FOOTER_HEIGHT)).toBe('32px');
  });
});

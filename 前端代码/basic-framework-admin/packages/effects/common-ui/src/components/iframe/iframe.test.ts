/**
 * 内嵌页组件（common-ui 的 components/iframe/iframe.vue）挂载与视口高度回归。
 *
 * 组件用于把外部页面嵌进管理端：挂载时先显示加载遮罩，延迟结束后按浏览器视口高度减去头部
 * 占用算出容器高度并解除遮罩。高度算错会让内嵌页塌陷成一条线或撑出滚动条，遮罩不解除会让
 * 用户永远停在转圈状态。用例真实挂载组件、真实推进组件声明的延迟计时器，并断言真实 DOM
 * 上的内嵌元素属性与容器内联高度。
 *
 * 说明：模板里的 v-loading 由应用外壳（apps/web-ele/src/bootstrap.ts 的
 * app.directive('loading', ElLoading.directive)）注册，本组件并不依赖 element-plus，
 * 测试环境没有这份应用级注册；这里用同名的记录型指令替身接收绑定值，用于断言组件把自己
 * 真实的加载状态交给了指令，指令本身的遮罩样式不属于本组件的职责。
 */
import type { Directive, DirectiveBinding } from 'vue';

import { mount } from '@vue/test-utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import IFrame from './iframe.vue';

/** 内嵌地址夹具：占位域名，避免测试依赖真实外站。 */
const IFRAME_SRC = 'https://DUMMY-embed.example.com/report';

/** 组件声明的初始化延迟，与源码中的 300ms 保持一致。 */
const INIT_DELAY = 300;

/** 容器高度要扣掉的头部占用像素，与源码保持一致。 */
const HEADER_OFFSET = 94.5;

/** 视口高度夹具：happy-dom 不做排版，clientHeight 恒为 0，无法反推真实浏览器高度。 */
const VIEWPORT_HEIGHT = 800;

/** v-loading 收到的每次绑定值，按收到顺序记录。 */
const loadingBindings: unknown[] = [];

/** v-loading 指令替身：只记录组件交给指令的加载状态，不渲染遮罩样式。 */
const recordingLoadingDirective: Directive = {
  /** 记录挂载时收到的加载状态。 */
  mounted: (_el: HTMLElement, binding: DirectiveBinding) => {
    loadingBindings.push(binding.value);
  },
  /** 记录状态更新后收到的加载状态。 */
  updated: (_el: HTMLElement, binding: DirectiveBinding) => {
    loadingBindings.push(binding.value);
  },
};

/** 每个用例挂载的组件，用例结束后统一卸载，避免残留影响后续用例。 */
let mounted: ReturnType<typeof mount> | undefined;

beforeEach(
  /** 接管延迟计时器、清空绑定记录，并给出真实浏览器才有排版结果的视口高度。 */ () => {
    loadingBindings.length = 0;
    vi.useFakeTimers();
    // 浏览器布局属于外部边界：happy-dom 不计算排版，这里给出确定视口高度以便核对换算公式。
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: VIEWPORT_HEIGHT,
    });
  },
);

afterEach(
  /** 卸载组件、恢复真实计时器并撤销视口高度替身。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
  },
);

/**
 * 挂载内嵌页组件。
 * @param src 内嵌页地址。
 * @returns 已挂载的组件包装器。
 */
function mountIFrame(src: string) {
  return mount(IFrame, {
    global: { directives: { loading: recordingLoadingDirective } },
    props: { src },
  });
}

describe('内嵌页挂载', /** 内嵌元素属性与加载状态决定页面能否正常显示外部内容。 */ () => {
  it('渲染指向源地址的内嵌元素', /** 地址或滚动属性丢失会让内嵌页无法加载或无法滚动。 */ () => {
    mounted = mountIFrame(IFRAME_SRC);

    const frame = mounted.find('iframe');
    expect(frame.attributes('src')).toBe(IFRAME_SRC);
    expect(frame.attributes('frameborder')).toBe('no');
    expect(frame.attributes('scrolling')).toBe('auto');
    // 挂载瞬间必须仍处于加载中，否则用户会先看到一块没有内容的区域。
    expect(loadingBindings).toEqual([true]);
  });

  it('延迟未到时保持加载中且不写死高度', /** 提前解除遮罩会让用户看到布局跳动的半成品页面。 */ async () => {
    mounted = mountIFrame(IFRAME_SRC);

    await vi.advanceTimersByTimeAsync(INIT_DELAY - 1);

    expect(loadingBindings).toEqual([true]);
    expect(mounted.element.style.height).toBe('');
  });
});

describe('内嵌页高度自适应', /** 容器高度决定内嵌页是否显示完整且不出现多余滚动。 */ () => {
  it('延迟结束后按视口高度计算容器高度并解除加载', /** 高度算错会让内嵌页塌陷，遮罩不解除会让页面一直转圈。 */ async () => {
    mounted = mountIFrame(IFRAME_SRC);

    await vi.advanceTimersByTimeAsync(INIT_DELAY);

    const expectedHeight = `${VIEWPORT_HEIGHT - HEADER_OFFSET}px`;
    expect(mounted.element.style.height).toBe(expectedHeight);
    // 高度写入后必须真实解除加载状态，绑定记录里要出现 false。
    expect(loadingBindings.at(-1)).toBe(false);
  });
});

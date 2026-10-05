/**
 * 滚动容器（shadcn-ui 的 components/scrollbar）滚动状态与阴影回归。
 *
 * 该容器给长内容加滚动条与上下阴影：滚动到底或到右时必须带上到达状态并把状态抛给调用方，
 * 阴影只在未到顶或未到底且开启阴影时出现。到达状态算错会让"加载更多"重复触发或阴影一直盖住内容。
 * 用例真实挂载容器，读取真实阴影节点与滚动事件载荷。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import VbenScrollbar from './scrollbar.vue';

/** 每个用例挂载的容器，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载容器，避免残留影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
  },
);

/**
 * 构造可控尺寸与滚动位置的滚动事件目标。
 * @param state 滚动位置与内容尺寸。
 * @param state.clientHeight 视口高度，用于判断是否已滚到底部。
 * @param state.clientWidth 视口宽度，用于判断是否已滚到右边缘。
 * @param state.scrollHeight 内容总高度。
 * @param state.scrollLeft 横向滚动位置。
 * @param state.scrollTop 纵向滚动位置。
 * @param state.scrollWidth 内容总宽度。
 * @returns 带尺寸属性的滚动事件目标元素。
 */
function scrollTargetElement(state: {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
}) {
  const element = document.createElement('div');
  for (const [key, value] of Object.entries(state)) {
    Object.defineProperty(element, key, { configurable: true, value });
  }
  return element;
}

describe('滚动容器阴影', /** 阴影状态决定用户能否察觉还有未滚动的内容。 */ () => {
  it('开启阴影后渲染上下阴影节点', /** 缺少阴影会让用户以为内容已到底。 */ () => {
    mounted = mount(VbenScrollbar, {
      props: { shadow: true, shadowBorder: true },
      slots: { default: '<div class="long-content">长内容</div>' },
    });

    expect(mounted.find('.scrollbar-top-shadow').exists()).toBe(true);
    expect(mounted.find('.scrollbar-bottom-shadow').exists()).toBe(true);
    expect(mounted.find('.long-content').text()).toBe('长内容');
    // 初始在顶部，顶部阴影不透明度为 0。
    expect(mounted.find('.scrollbar-top-shadow').classes()).not.toContain(
      'opacity-100',
    );
  });

  it('未开启阴影时不渲染阴影节点', /** 默认渲染阴影会遮挡内容。 */ () => {
    mounted = mount(VbenScrollbar, {
      slots: { default: '<div class="long-content">长内容</div>' },
    });

    expect(mounted.find('.scrollbar-top-shadow').exists()).toBe(false);
    expect(mounted.find('.scrollbar-bottom-shadow').exists()).toBe(false);
  });

  it('开启横向滚动条时容器保留裁剪与相对定位', /** 宽表需要在同一容器内左右滚动而不撑破布局。 */ () => {
    mounted = mount(VbenScrollbar, {
      props: { horizontal: true, scrollBarClass: 'custom-bar' },
      slots: { default: '<div class="long-content">长内容</div>' },
    });

    const area = mounted.find('.vben-scrollbar');
    expect(area.classes()).toContain('relative');
    expect(area.classes()).toContain('overflow-hidden');
    expect(mounted.find('.long-content').exists()).toBe(true);
  });

  it('左右都开启阴影时按两端状态渲染阴影类', /** 左右阴影同时开启会让水平列表看不出还有隐藏列。 */ () => {
    mounted = mount(VbenScrollbar, {
      props: {
        shadow: true,
        shadowLeft: true,
        shadowRight: true,
      },
      slots: { default: '<div class="long-content">长内容</div>' },
    });

    // 初始位于最左端：只有右侧还有内容，因此只出现右阴影。
    expect(mounted.find('.vben-scrollbar').classes()).toContain('right-shadow');
    expect(mounted.find('.vben-scrollbar').classes()).not.toContain(
      'left-shadow',
    );
  });
});

describe('滚动容器到达状态', /** 到达状态决定加载更多与阴影是否触发。 */ () => {
  it('滚动到中间时标记两端都未到达并显示阴影', /** 状态算错会让加载更多提前触发。 */ async () => {
    mounted = mount(VbenScrollbar, {
      props: { shadow: true },
      slots: { default: '<div class="long-content">长内容</div>' },
    });
    const viewport = mounted.find('[data-reka-scroll-area-viewport]');
    const target = scrollTargetElement({
      clientHeight: 100,
      clientWidth: 100,
      scrollHeight: 400,
      scrollLeft: 0,
      scrollTop: 50,
      scrollWidth: 400,
    });
    Object.defineProperty(viewport.element, 'scrollTop', {
      configurable: true,
      value: 50,
    });

    const event = new Event('scroll');
    Object.defineProperty(event, 'target', { value: target });
    viewport.element.dispatchEvent(event);
    await nextTick();

    expect(mounted.emitted('scrollAt')?.[0]?.[0]).toEqual({
      bottom: false,
      left: true,
      right: false,
      top: false,
    });
    expect(mounted.find('.scrollbar-top-shadow').classes()).toContain(
      'opacity-100',
    );
    expect(mounted.find('.scrollbar-bottom-shadow').classes()).toContain(
      'opacity-100',
    );
  });

  it('滚动到中间且左右都开启阴影时同时显示左右阴影', /** 两端都有隐藏内容时必须同时给出左右提示。 */ async () => {
    mounted = mount(VbenScrollbar, {
      props: { shadow: true, shadowLeft: true, shadowRight: true },
      slots: { default: '<div class="long-content">长内容</div>' },
    });
    const viewport = mounted.find('[data-reka-scroll-area-viewport]');
    const target = scrollTargetElement({
      clientHeight: 100,
      clientWidth: 100,
      scrollHeight: 400,
      scrollLeft: 100,
      scrollTop: 100,
      scrollWidth: 400,
    });

    const event = new Event('scroll');
    Object.defineProperty(event, 'target', { value: target });
    viewport.element.dispatchEvent(event);
    await nextTick();

    expect(mounted.find('.vben-scrollbar').classes()).toContain('both-shadow');
    expect(mounted.emitted('scrollAt')?.[0]?.[0]).toEqual({
      bottom: false,
      left: false,
      right: false,
      top: false,
    });
  });

  it('滚动到底部与右边缘时标记为已到达', /** 到达状态未识别会让加载更多无法停止。 */ async () => {
    mounted = mount(VbenScrollbar, {
      props: { shadow: true },
      slots: { default: '<div class="long-content">长内容</div>' },
    });
    const viewport = mounted.find('[data-reka-scroll-area-viewport]');
    const target = scrollTargetElement({
      clientHeight: 100,
      clientWidth: 100,
      scrollHeight: 150,
      scrollLeft: 300,
      scrollTop: 50,
      scrollWidth: 400,
    });

    const event = new Event('scroll');
    Object.defineProperty(event, 'target', { value: target });
    viewport.element.dispatchEvent(event);
    await nextTick();

    expect(mounted.emitted('scrollAt')?.[0]?.[0]).toEqual({
      bottom: true,
      left: false,
      right: true,
      top: false,
    });
  });
});

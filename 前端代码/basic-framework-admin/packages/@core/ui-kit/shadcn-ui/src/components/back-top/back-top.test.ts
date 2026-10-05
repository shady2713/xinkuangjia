/**
 * 回到顶部按钮（shadcn-ui 的 components/back-top/back-top.vue）显隐与定位回归。
 *
 * 该按钮挂在长列表右下角：文档滚动超过 visibilityHeight 才出现，点击后要把文档滚回顶部，
 * 位置由 bottom 与 right 决定。显隐阈值或定位写错会让按钮常驻遮挡内容，或点了没有回到顶部。
 * 用例真实挂载组件，用真实的 documentElement 滚动位置驱动显隐，并断言真实滚动调用。
 */
import { mount } from '@vue/test-utils';

import { afterEach, describe, expect, it, vi } from 'vitest';

import BackTop from './back-top.vue';

/** 每个用例挂载的按钮，用例结束后统一卸载。 */
let mounted: ReturnType<typeof mount> | undefined;

/** 用例替换掉的 documentElement.scrollTo，用例结束后还原。 */
let originalScrollTo: typeof document.documentElement.scrollTo | undefined;

afterEach(
  /** 还原滚动打桩与滚动位置，避免影响后续用例。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    document.documentElement.scrollTop = 0;
    if (originalScrollTo) {
      document.documentElement.scrollTo = originalScrollTo;
      originalScrollTo = undefined;
    }
    vi.restoreAllMocks();
  },
);

/**
 * 在指定文档滚动位置挂载回到顶部按钮。
 * @param scrollTop 挂载前文档的滚动位置。
 * @param props 传给按钮的属性，用于核对定位与阈值覆盖。
 * @returns 已挂载的按钮包装器。
 */
async function mountAtScroll(
  scrollTop: number,
  props: Record<string, unknown> = {},
) {
  document.documentElement.scrollTop = scrollTop;
  const wrapper = mount(BackTop, { props });
  // 组件在挂载时读取一次文档滚动位置决定初始显隐。
  await wrapper.vm.$nextTick();
  return wrapper;
}

describe('回到顶部按钮显隐', /** 显隐阈值决定按钮是否遮挡内容。 */ () => {
  it('初始未达到阈值时不渲染按钮', /** 未滚动就渲染会让按钮常驻遮挡右下角内容。 */ async () => {
    mounted = await mountAtScroll(0);

    expect(mounted.find('button').exists()).toBe(false);
  });

  it('滚动超过阈值后渲染按钮并按属性定位', /** 阈值或定位写错会让按钮出现过早或贴边。 */ async () => {
    mounted = await mountAtScroll(300, { bottom: 40, right: 12 });

    const button = mounted.find('button');
    expect(button.exists()).toBe(true);
    expect(button.attributes('style')).toContain('bottom: 40px');
    expect(button.attributes('style')).toContain('right: 12px');
    expect(button.classes()).toContain('fixed');
    expect(button.classes()).toContain('rounded-full');
  });

  it('可见阈值可由调用方调整', /** 阈值写死会让短列表也出现回到顶部按钮。 */ async () => {
    mounted = await mountAtScroll(300, { visibilityHeight: 500 });

    expect(mounted.find('button').exists()).toBe(false);
  });
});

describe('回到顶部按钮点击', /** 点击行为决定用户能否一键回到顶部。 */ () => {
  it('点击后把文档平滑滚回顶部', /** 点击无滚动会让按钮成为装饰。 */ async () => {
    const scrollTo = vi.fn();
    originalScrollTo = document.documentElement.scrollTo;
    document.documentElement.scrollTo = scrollTo;
    mounted = await mountAtScroll(300);

    await mounted.find('button').trigger('click');

    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 0 });
  });
});

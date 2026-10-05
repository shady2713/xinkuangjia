/**
 * 后台布局非自动隐藏顶栏下的滚动行为（layout-ui 的 admin-layout）真实回归。
 *
 * 布局只在 `headerMode === 'auto-scroll'` 时才允许滚动驱动顶栏自动隐藏；固定顶栏、
 * 混合导航或全内容布局下，滚动事件必须原样返回，不能改动顶栏可见性，否则固定顶栏会在
 * 用户滚动时莫名其妙消失。用例真实挂载布局、真实派发滚动事件，断言固定顶栏在滚动后
 * 仍然可见（位置仍为 0）。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import AdminLayout from './admin-layout.vue';

/** 用例挂载的布局包装器，用例结束后统一卸载，避免全局监听残留。 */
let wrapper: ReturnType<typeof mount> | undefined;

afterEach(
  /** 卸载布局并把注入的文档滚动量复位，避免用例之间互相影响。 */ () => {
    wrapper?.unmount();
    wrapper = undefined;
    Object.defineProperty(document.documentElement, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(document.body, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
  },
);

/**
 * 注入文档滚动位置并派发真实滚动事件；happy-dom 不排版，因此按浏览器契约直接写入滚动量。
 * @param top 目标滚动位置。
 */
function scrollTo(top: number) {
  Object.defineProperty(document.documentElement, 'scrollTop', {
    configurable: true,
    value: top,
  });
  Object.defineProperty(document.body, 'scrollTop', {
    configurable: true,
    value: top,
  });
  document.dispatchEvent(new Event('scroll'));
}

/**
 * 取顶栏外层容器；它是顶栏组件的父元素，承载顶栏与标签栏的定位样式。
 * @param target 已挂载的布局包装器。
 * @returns 顶栏外层的 style 属性内容。
 */
function headerWrapperStyle(target: ReturnType<typeof mount>) {
  const column = target.find('.flex.flex-1.flex-col').element as HTMLElement;
  const headerBox = column.firstElementChild as HTMLElement | null;
  return headerBox?.getAttribute('style') ?? '';
}

describe('固定顶栏下的滚动', /** 固定顶栏被滚动隐藏会让用户失去导航。 */ () => {
  it('headerMode 为 fixed 时滚动不改变顶栏位置', /** 早退分支缺失会让非 auto-scroll 布局也走自动隐藏。 */ async () => {
    wrapper = mount(AdminLayout, {
      props: {
        headerHeight: 50,
        headerMode: 'fixed',
        tabbarEnable: false,
      },
      slots: { content: '<i class="DUMMY-content"></i>' },
    });
    await nextTick();

    expect(headerWrapperStyle(wrapper)).toContain('top: 0px');

    // 固定顶栏下滚动必须原样返回：顶栏位置保持 0，不进入自动隐藏。
    scrollTo(400);
    await nextTick();
    await nextTick();

    expect(headerWrapperStyle(wrapper)).toContain('top: 0px');
  });
});

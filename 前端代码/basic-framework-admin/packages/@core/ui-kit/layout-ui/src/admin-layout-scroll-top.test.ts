/**
 * 后台布局无顶栏高度时滚动回顶恢复顶栏的真实行为回归。
 *
 * 布局把「文档滚动量」换算成顶栏的自动隐藏状态：滚动量小于顶栏总高、或已经回到顶部时都必须
 * 把顶栏恢复显示。顶栏总高由 headerHeight 与标签栏高度相加得到，因此把顶栏渲染为不占位
 * （headerHeight 为 0 且标签栏关闭）时总高为 0，此时「滚动量小于总高」不再成立，回顶恢复
 * 只能由顶部到达判定这一条分支兜住；该分支缺失会让无头布局在回顶后顶栏仍保持隐藏，
 * 用户看不到导航。用例真实挂载布局、真实派发滚动事件，断言回到顶部后顶栏重新可见。
 */
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

import { afterEach, describe, expect, it } from 'vitest';

import AdminLayout from './admin-layout.vue';

/** 用例挂载的布局包装器，用例结束后统一卸载，避免全局监听残留。 */
let wrapper: ReturnType<typeof mount> | undefined;

/** 节流窗口：组件对滚动回调做了 300 毫秒节流，等过它才能让下一次滚动成为前导调用。 */
const THROTTLE_WINDOW = 350;

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
 * 等待节流窗口过去，让下一次滚动重新成为节流函数的前导调用。
 */
async function passThrottleWindow() {
  await new Promise(
    /** 真实等待节流窗口，不使用固定休眠猜测组件内部时序。 */ (resolve) =>
      setTimeout(resolve, THROTTLE_WINDOW),
  );
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

describe('无顶栏高度时的滚动回顶', /** 顶部到达分支缺失会让无头布局回顶后导航仍然隐藏。 */ () => {
  it('回顶后顶栏恢复可见', /** 顶栏总高为 0 时只能靠顶部到达判定恢复显示。 */ async () => {
    wrapper = mount(AdminLayout, {
      props: {
        headerHeight: 0,
        headerMode: 'auto-scroll',
        tabbarEnable: false,
      },
      slots: { content: '<i class="DUMMY-content"></i>' },
    });
    await nextTick();

    expect(headerWrapperStyle(wrapper)).toContain('top: 0px');

    // 向下滚动：越过 0 高度的顶栏总高且方向向下，顶栏进入隐藏态。
    scrollTo(400);
    await nextTick();
    await passThrottleWindow();

    // 回到顶部：滚动量为 0 不再小于顶栏总高，由顶部到达判定恢复显示。
    scrollTo(0);
    await nextTick();

    expect(headerWrapperStyle(wrapper)).toContain('top: 0px');
    expect(wrapper.find('.DUMMY-content').exists()).toBe(true);
  });
});

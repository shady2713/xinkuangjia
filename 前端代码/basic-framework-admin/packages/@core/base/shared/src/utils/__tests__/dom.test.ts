/** DOM 尺寸工具的测试：可见矩形裁剪、滚动条宽度测量、是否需要滚动条与 resize 派发。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getElementVisibleRect,
  getScrollbarWidth,
  needsScrollbar,
  triggerWindowResize,
} from '../dom';

describe('getElementVisibleRect', /** 元素可见矩形要把超出视口的部分裁掉，完全不可见时归零。 */ () => {
  // 设置浏览器视口尺寸的 mock
  beforeEach(() => {
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(
      800,
    );
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(
      1000,
    );
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
  });

  it('should return default rect if element is undefined', () => {
    expect(getElementVisibleRect()).toEqual({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    });
  });

  it('should return default rect if element is null', () => {
    expect(getElementVisibleRect(null)).toEqual({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    });
  });

  it('should return correct visible rect when element is fully visible', () => {
    const element = {
      getBoundingClientRect: () => ({
        bottom: 400,
        height: 300,
        left: 200,
        right: 600,
        top: 100,
        width: 400,
      }),
    } as HTMLElement;

    expect(getElementVisibleRect(element)).toEqual({
      bottom: 400,
      height: 300,
      left: 200,
      right: 600,
      top: 100,
      width: 400,
    });
  });

  it('should return correct visible rect when element is partially off-screen at the top', () => {
    const element = {
      getBoundingClientRect: () => ({
        bottom: 200,
        height: 250,
        left: 100,
        right: 500,
        top: -50,
        width: 400,
      }),
    } as HTMLElement;

    expect(getElementVisibleRect(element)).toEqual({
      bottom: 200,
      height: 200,
      left: 100,
      right: 500,
      top: 0,
      width: 400,
    });
  });

  it('should return correct visible rect when element is partially off-screen at the right', () => {
    const element = {
      getBoundingClientRect: () => ({
        bottom: 400,
        height: 300,
        left: 800,
        right: 1200,
        top: 100,
        width: 400,
      }),
    } as HTMLElement;

    expect(getElementVisibleRect(element)).toEqual({
      bottom: 400,
      height: 300,
      left: 800,
      right: 1000,
      top: 100,
      width: 200,
    });
  });

  it('should return all zeros when element is completely off-screen', () => {
    const element = {
      getBoundingClientRect: () => ({
        bottom: 1200,
        height: 300,
        left: 1100,
        right: 1400,
        top: 900,
        width: 300,
      }),
    } as HTMLElement;

    expect(getElementVisibleRect(element)).toEqual({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    });
  });
});

describe('getScrollbarWidth', /** 用探针元素量出滚动条宽度，量完必须把探针从文档里移除。 */ () => {
  afterEach(
    /** 恢复真实的 offsetWidth，避免影响其它用例。 */ () => {
      vi.restoreAllMocks();
    },
  );

  it('returns the width difference between the outer and inner probe', /** 差值就是滚动条占用的宽度。 */ () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
      /** 外层探针带子节点，内层不带，用它区分两者。 */
      function offsetWidthStub(this: HTMLElement) {
        return this.firstElementChild ? 20 : 17;
      },
    );
    const before = document.body.childElementCount;

    const width = getScrollbarWidth();

    expect(width).toBe(3);
    expect(document.body.childElementCount).toBe(before);
  });

  it('returns zero when the probes have the same width', /** 没有滚动条时差值为 0。 */ () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(15);

    expect(getScrollbarWidth()).toBe(0);
  });
});

describe('needsScrollbar', /** 依据 overflow-y 与文档高度判断是否需要预留滚动条。 */ () => {
  afterEach(
    /** 恢复真实样式与视口，避免影响其它用例。 */ () => {
      vi.restoreAllMocks();
    },
  );

  it('returns true when overflow-y is scroll and the document is taller than the viewport', /** 显式滚动且内容超高时需要滚动条。 */ () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      overflowY: 'scroll',
    } as CSSStyleDeclaration);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      5000,
    );
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);

    expect(needsScrollbar()).toBe(true);
  });

  it('returns false when overflow-y is scroll but the content fits', /** 内容不高时即使声明 scroll 也不需要滚动条。 */ () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      overflowY: 'scroll',
    } as CSSStyleDeclaration);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      100,
    );
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);

    expect(needsScrollbar()).toBe(false);
  });

  it('falls back to comparing heights for other overflow values', /** overflow-y 不是 scroll/auto 时也按高度判断。 */ () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      overflowY: 'hidden',
    } as CSSStyleDeclaration);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      5000,
    );
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);

    expect(needsScrollbar()).toBe(true);
  });

  it('returns false for other overflow values when the content fits', /** 内容不高时同样返回 false。 */ () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      overflowY: 'visible',
    } as CSSStyleDeclaration);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      100,
    );
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);

    expect(needsScrollbar()).toBe(false);
  });
});

describe('triggerWindowResize', /** 派发 resize 事件，通知依赖尺寸的组件重新布局。 */ () => {
  afterEach(
    /** 移除本例注册的监听器，避免影响其它用例。 */ () => {
      vi.restoreAllMocks();
    },
  );

  it('dispatches a resize event on window', /** 监听方必须收到 resize。 */ () => {
    const listener = vi.fn();
    window.addEventListener('resize', listener);

    triggerWindowResize();

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).toBeInstanceOf(Event);
    window.removeEventListener('resize', listener);
  });
});

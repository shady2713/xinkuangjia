/**
 * 滚动锁定：锁住 body 滚动并补偿滚动条宽度，卸载时还原，避免打开浮层时抖动。
 *
 * 同时把宽度补到带 SCROLL_FIXED_CLASS 标记的固定定位元素，该标记由布局层使用；
 * 这里只处理滚动条占位，不管浮层的显隐、层级与焦点管理。
 */
import { getScrollbarWidth, needsScrollbar } from '@vben-core/shared/utils';

import {
  useScrollLock as _useScrollLock,
  tryOnBeforeUnmount,
  tryOnMounted,
} from '@vueuse/core';

/** 需要跟随滚动条宽度一起补偿的固定定位元素类名，由布局层标记在浮层上。 */
export const SCROLL_FIXED_CLASS = `_scroll__fixed_`;

/**
 * 锁住 body 滚动并补偿滚动条宽度，卸载时还原；补偿同时作用于带 SCROLL_FIXED_CLASS 标记的元素。
 * 依赖组件的挂载与卸载钩子，必须在 setup 中调用；浮层的显隐、层级与焦点不归它管。
 */
export function useScrollLock() {
  const isLocked = _useScrollLock(document.body);
  const scrollbarWidth = getScrollbarWidth();

  tryOnMounted(() => {
    if (!needsScrollbar()) {
      return;
    }
    document.body.style.paddingRight = `${scrollbarWidth}px`;

    const layoutFixedNodes = document.querySelectorAll<HTMLElement>(
      `.${SCROLL_FIXED_CLASS}`,
    );
    const nodes = [...layoutFixedNodes];
    if (nodes.length > 0) {
      nodes.forEach((node) => {
        node.dataset.transition = node.style.transition;
        node.style.transition = 'none';
        node.style.paddingRight = `${scrollbarWidth}px`;
      });
    }
    isLocked.value = true;
  });

  tryOnBeforeUnmount(() => {
    if (!needsScrollbar()) {
      return;
    }
    isLocked.value = false;
    const layoutFixedNodes = document.querySelectorAll<HTMLElement>(
      `.${SCROLL_FIXED_CLASS}`,
    );
    const nodes = [...layoutFixedNodes];
    if (nodes.length > 0) {
      nodes.forEach((node) => {
        node.style.paddingRight = '';
        requestAnimationFrame(() => {
          node.style.transition = node.dataset.transition || '';
        });
      });
    }
    document.body.style.paddingRight = '';
  });
}

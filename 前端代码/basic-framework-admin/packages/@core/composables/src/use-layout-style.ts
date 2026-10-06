/**
 * 布局尺寸样式：把内容区与顶栏、底栏的像素尺寸同步到全局 CSS 变量。
 *
 * useLayoutContentStyle 用 ResizeObserver 跟踪内容区可见区域并给出遮罩定位；
 * 三个组合式函数只读写 CSS 变量，不渲染 DOM，也不参与主题与路由计算。
 */
import type { CSSProperties } from 'vue';

import type { VisibleDomRect } from '@vben-core/shared/utils';

import { computed, onMounted, onUnmounted, ref } from 'vue';

import {
  CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT,
  CSS_VARIABLE_LAYOUT_CONTENT_WIDTH,
  CSS_VARIABLE_LAYOUT_FOOTER_HEIGHT,
  CSS_VARIABLE_LAYOUT_HEADER_HEIGHT,
} from '@vben-core/shared/constants';
import { getElementVisibleRect } from '@vben-core/shared/utils';

import { useCssVar, useDebounceFn } from '@vueuse/core';

/**
 * 跟踪内容区的可见区域，把宽高写入全局 CSS 变量，并给出遮罩定位样式。
 * 必须在组件 setup 中调用：挂载后建立 ResizeObserver，卸载时自动断开。
 * @zh_CN content style
 * @returns contentElement 需绑到内容区元素；overlayStyle 供浮层定位；
 *   visibleDomRect 为最近一次测量结果，尚未测量时为 null。
 */
export function useLayoutContentStyle() {
  let resizeObserver: null | ResizeObserver = null;
  const contentElement = ref<HTMLDivElement | null>(null);
  const visibleDomRect = ref<null | VisibleDomRect>(null);
  const contentHeight = useCssVar(CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT);
  const contentWidth = useCssVar(CSS_VARIABLE_LAYOUT_CONTENT_WIDTH);

  // 遮罩定位样式：直接取最近一次可见矩形，尚未测量时各项为 undefined。
  const overlayStyle = computed((): CSSProperties => {
    const { height, left, top, width } = visibleDomRect.value ?? {};
    return {
      height: `${height}px`,
      left: `${left}px`,
      position: 'fixed',
      top: `${top}px`,
      width: `${width}px`,
      zIndex: 150,
    };
  });

  // 合并 16ms 内的多次尺寸回调，避免连续拖拽时反复读写 CSS 变量。
  const debouncedCalcHeight = useDebounceFn(
    (_entries: ResizeObserverEntry[]) => {
      visibleDomRect.value = getElementVisibleRect(contentElement.value);
      contentHeight.value = `${visibleDomRect.value.height}px`;
      contentWidth.value = `${visibleDomRect.value.width}px`;
    },
    16,
  );

  onMounted(() => {
    if (contentElement.value && !resizeObserver) {
      resizeObserver = new ResizeObserver(debouncedCalcHeight);
      resizeObserver.observe(contentElement.value);
    }
  });

  onUnmounted(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return { contentElement, overlayStyle, visibleDomRect };
}

/**
 * 读写顶栏高度对应的 CSS 变量，供布局层在顶栏挂载、隐藏时同步尺寸。
 * @returns 读取函数返回当前顶栏高度，写入函数接收像素数值。
 */
export function useLayoutHeaderStyle() {
  const headerHeight = useCssVar(CSS_VARIABLE_LAYOUT_HEADER_HEIGHT);

  return {
    /** 读取顶栏高度，单位为像素。 */
    getLayoutHeaderHeight: () => {
      return Number.parseInt(`${headerHeight.value}`, 10);
    },
    /** 写入顶栏高度，参数按像素数值处理。 */
    setLayoutHeaderHeight: (height: number) => {
      headerHeight.value = `${height}px`;
    },
  };
}

/**
 * 读写底栏高度对应的 CSS 变量，供布局层在底栏显隐时同步尺寸。
 * @returns 读取函数返回当前底栏高度，写入函数接收像素数值。
 */
export function useLayoutFooterStyle() {
  const footerHeight = useCssVar(CSS_VARIABLE_LAYOUT_FOOTER_HEIGHT);

  return {
    /** 读取底栏高度，单位为像素。 */
    getLayoutFooterHeight: () => {
      return Number.parseInt(`${footerHeight.value}`, 10);
    },
    /** 写入底栏高度，参数按像素数值处理。 */
    setLayoutFooterHeight: (height: number) => {
      footerHeight.value = `${height}px`;
    },
  };
}

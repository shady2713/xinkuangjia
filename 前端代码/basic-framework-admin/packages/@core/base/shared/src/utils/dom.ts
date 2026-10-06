/**
 * DOM 度量工具：读取元素在视口内的可见矩形、滚动条宽度与滚动条有无。
 * 供布局容器与浮层定位使用，并可在尺寸变化后手动派发 resize 事件；
 * 只做一次性同步测量，不监听尺寸变化，也不修改元素样式。
 */
export interface VisibleDomRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

/**
 * 获取元素可见信息
 * @param element - 待测量的元素；为空时跳过测量，直接返回全零矩形。
 * @returns 元素与视口相交部分的矩形；元素完全落在视口外时同样返回全零矩形。
 */
export function getElementVisibleRect(
  element?: HTMLElement | null | undefined,
): VisibleDomRect {
  if (!element) {
    return {
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    };
  }
  const rect = element.getBoundingClientRect();
  const viewHeight = Math.max(
    document.documentElement.clientHeight,
    window.innerHeight,
  );

  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.bottom, viewHeight);

  const viewWidth = Math.max(
    document.documentElement.clientWidth,
    window.innerWidth,
  );

  const left = Math.max(rect.left, 0);
  const right = Math.min(rect.right, viewWidth);

  // 如果元素完全不可见，则返回一个空的矩形
  if (top >= viewHeight || bottom <= 0 || left >= viewWidth || right <= 0) {
    return {
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    };
  }

  return {
    bottom,
    height: Math.max(0, bottom - top),
    left,
    right,
    top,
    width: Math.max(0, right - left),
  };
}

/**
 * 测量当前浏览器纵向滚动条的像素宽度。
 * 会临时向 body 末尾插入一个隐藏的滚动容器并立即移除，不在页面上留下节点。
 * @returns 滚动条占用宽度；使用悬浮滚动条的移动端或系统返回 0。
 */
export function getScrollbarWidth() {
  const scrollDiv = document.createElement('div');

  scrollDiv.style.visibility = 'hidden';
  scrollDiv.style.overflow = 'scroll';
  scrollDiv.style.position = 'absolute';
  scrollDiv.style.top = '-9999px';

  document.body.append(scrollDiv);

  const innerDiv = document.createElement('div');
  scrollDiv.append(innerDiv);

  const scrollbarWidth = scrollDiv.offsetWidth - innerDiv.offsetWidth;

  scrollDiv.remove();
  return scrollbarWidth;
}

/**
 * 判断页面内容是否已超出视口高度、需要纵向滚动条。
 * 会读取 body 的 overflow-y 计算样式，但 scroll/auto 与其它取值最终都走同一比较判据。
 * @returns 文档 scrollHeight 大于视口高度时为 true。
 */
export function needsScrollbar() {
  const doc = document.documentElement;
  const body = document.body;

  // 检查 body 的 overflow-y 样式
  const overflowY = window.getComputedStyle(body).overflowY;

  // 如果明确设置了需要滚动条的样式
  if (overflowY === 'scroll' || overflowY === 'auto') {
    return doc.scrollHeight > window.innerHeight;
  }

  // 在其他情况下，根据 scrollHeight 和 innerHeight 比较判断
  return doc.scrollHeight > window.innerHeight;
}

/**
 * 手动派发一次 window 的 resize 事件，让依赖视口尺寸的组件重新测量。
 * 只派发事件，不修改任何元素样式，也不等待监听方处理完成。
 */
export function triggerWindowResize(): void {
  // 创建一个新的 resize 事件
  const resizeEvent = new Event('resize');

  // 触发 window 的 resize 事件
  window.dispatchEvent(resizeEvent);
}

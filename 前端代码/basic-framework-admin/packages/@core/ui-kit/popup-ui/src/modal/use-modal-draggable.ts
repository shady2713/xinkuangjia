/**
 * Draggable modal behavior adapted for the current popup layer.
 * 调整部分细节
 */

import type { ComputedRef, Ref } from 'vue';

import { onBeforeUnmount, onMounted, reactive, ref, watchEffect } from 'vue';

import { unrefElement } from '@vueuse/core';

/**
 * 给弹窗接上标题栏拖拽：按下时按容器或视口边界算出允许位移，
 * 移动过程中把位移写进被拖节点的 transform，组件卸载时自动解绑。
 * @param targetRef 被拖动的弹窗内容节点，位移以它的 inline transform 体现；节点缺失时按下事件被忽略。
 * @param dragRef 拖拽手柄节点，通常是标题栏；它缺失时不会绑定任何监听。
 * @param draggable 是否允许拖拽的响应式开关，翻转时自动解绑或重新绑定手柄。
 * @param containerSelector 可选的容器选择器，给出时按容器边界限制位移，省略时按视口边界限制。
 * @param centered 弹窗是否居中，决定位移是否叠加垂直方向的 -50% 居中偏移。
 * @returns 位移、是否正在拖动与重置方法，供视图绑定样式或复位使用。
 */
export function useModalDraggable(
  targetRef: Ref<HTMLElement | undefined>,
  dragRef: Ref<HTMLElement | undefined>,
  draggable: ComputedRef<boolean>,
  containerSelector?: ComputedRef<string | undefined>,
  centered?: ComputedRef<boolean>,
) {
  const transform = reactive({
    offsetX: 0,
    offsetY: 0,
  });

  const dragging = ref(false);

  /**
   * 拖拽起点：记下按下的位置，并按容器或视口算出本次拖拽允许的位移区间，
   * 再把移动与抬起监听挂到 document 上。被拖节点尚未挂载时直接返回。
   * @param e 按下事件，只取 clientX/clientY 作为拖拽起点。
   */
  const onMousedown = (e: MouseEvent) => {
    const downX = e.clientX;
    const downY = e.clientY;

    if (!targetRef.value) {
      return;
    }

    const targetRect = targetRef.value.getBoundingClientRect();
    const { offsetX, offsetY } = transform;
    const targetLeft = targetRect.left;
    const targetTop = targetRect.top;
    const targetWidth = targetRect.width;
    const targetHeight = targetRect.height;

    let containerRect: DOMRect | null = null;

    if (containerSelector?.value) {
      const container = document.querySelector(containerSelector.value);
      if (container) {
        containerRect = container.getBoundingClientRect();
      }
    }

    let maxLeft, maxTop, minLeft, minTop;
    if (containerRect) {
      minLeft = containerRect.left - targetLeft + offsetX;
      maxLeft = containerRect.right - targetLeft - targetWidth + offsetX;
      minTop = containerRect.top - targetTop + offsetY;
      maxTop = containerRect.bottom - targetTop - targetHeight + offsetY;
    } else {
      const docElement = document.documentElement;
      const clientWidth = docElement.clientWidth;
      const clientHeight = docElement.clientHeight;
      minLeft = -targetLeft + offsetX;
      minTop = -targetTop + offsetY;
      maxLeft = clientWidth - targetLeft - targetWidth + offsetX;
      maxTop = clientHeight - targetTop - targetHeight + offsetY;
    }

    /**
     * 拖拽过程中按位移增量更新 transform，并夹在按下时算好的区间内，
     * 避免弹窗被拖出可视区域；居中时额外叠加 -50% 的垂直偏移。
     * @param e 移动事件，取相对按下点的位移增量。
     */
    const onMousemove = (e: MouseEvent) => {
      let moveX = offsetX + e.clientX - downX;
      let moveY = offsetY + e.clientY - downY;

      moveX = Math.min(Math.max(moveX, minLeft), maxLeft);
      moveY = Math.min(Math.max(moveY, minTop), maxTop);

      transform.offsetX = moveX;
      transform.offsetY = moveY;

      if (targetRef.value) {
        const isCentered = centered?.value;
        targetRef.value.style.transform = isCentered
          ? `translate(${moveX}px, calc(-50% + ${moveY}px))`
          : `translate(${moveX}px, ${moveY}px)`;
        dragging.value = true;
      }
    };

    /** 结束本次拖拽：清掉拖动标记，并移除 document 上的移动与抬起监听。 */
    const onMouseup = () => {
      dragging.value = false;
      document.removeEventListener('mousemove', onMousemove);
      document.removeEventListener('mouseup', onMouseup);
    };

    document.addEventListener('mousemove', onMousemove);
    document.addEventListener('mouseup', onMouseup);
  };

  /** 开启拖拽：把手柄的 mousedown 绑到拖拽起点；手柄或被拖节点缺失时静默跳过。 */
  const onDraggable = () => {
    const dragDom = unrefElement(dragRef);
    if (dragDom && targetRef.value) {
      dragDom.addEventListener('mousedown', onMousedown);
    }
  };

  /** 关闭拖拽：解绑手柄上的 mousedown；节点缺失时同样静默跳过，因此可重复调用。 */
  const offDraggable = () => {
    const dragDom = unrefElement(dragRef);
    if (dragDom && targetRef.value) {
      dragDom.removeEventListener('mousedown', onMousedown);
    }
  };

  /** 复位弹窗位置：位移归零并抹掉节点上的 inline transform，重新居中时由视图调用。 */
  const resetPosition = () => {
    transform.offsetX = 0;
    transform.offsetY = 0;

    const target = unrefElement(targetRef);
    if (target) {
      target.style.transform = '';
    }
  };

  onMounted(() => {
    watchEffect(() => {
      if (draggable.value) {
        onDraggable();
      } else {
        offDraggable();
      }
    });
  });

  onBeforeUnmount(() => {
    offDraggable();
  });

  return {
    dragging,
    resetPosition,
    transform,
  };
}

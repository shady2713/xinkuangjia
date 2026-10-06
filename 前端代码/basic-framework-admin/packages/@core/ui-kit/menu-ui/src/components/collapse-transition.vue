<script lang="ts" setup>
/**
 * 菜单折叠过渡：通过过渡钩子改写元素高度与内边距。
 *
 * 用于子菜单展开收起，原样式值暂存在 dataset，折叠状态由父组件决定。
 */
import type { RendererElement } from 'vue';

defineOptions({
  name: 'CollapseTransition',
});

/**
 * 收起过渡结束后调用：清空 maxHeight 上限，并把 overflow 还原为过渡前暂存在 dataset 的值。
 * @param el 正在做收起过渡的元素，其暂存样式取自 beforeLeave 写入的 dataset。
 */
const reset = (el: RendererElement) => {
  el.style.maxHeight = '';
  el.style.overflow = el.dataset.oldOverflow;
  el.style.paddingTop = el.dataset.oldPaddingTop;
  el.style.paddingBottom = el.dataset.oldPaddingBottom;
};

const on = {
  /**
   * 展开动画结束后收尾：去掉 maxHeight 限制并恢复原 overflow，元素交回内容自适应高度。
   * @param el 正在做展开过渡的元素。
   */
  afterEnter(el: RendererElement) {
    el.style.maxHeight = '';
    el.style.overflow = el.dataset.oldOverflow;
  },

  /**
   * 收起动画结束后把 maxHeight 与内边距、overflow 全部还原，交回内容自适应高度。
   * @param el 正在做收起过渡的元素。
   */
  afterLeave(el: RendererElement) {
    reset(el);
  },

  /**
   * 展开前记录当前四向内外边距与固定高度，并把内外边距和 maxHeight 归零作为动画起点。
   * @param el 即将做展开过渡的元素；dataset 缺失时先补建，避免暂存值丢失。
   */
  beforeEnter(el: RendererElement) {
    if (!el.dataset) el.dataset = {};

    el.dataset.oldPaddingTop = el.style.paddingTop;
    el.dataset.oldMarginTop = el.style.marginTop;

    el.dataset.oldPaddingBottom = el.style.paddingBottom;
    el.dataset.oldMarginBottom = el.style.marginBottom;
    if (el.style.height) el.dataset.elExistsHeight = el.style.height;

    el.style.maxHeight = 0;
    el.style.paddingTop = 0;
    el.style.marginTop = 0;
    el.style.paddingBottom = 0;
    el.style.marginBottom = 0;
  },

  /**
   * 收起前暂存四向内外边距与 overflow，并把 maxHeight 抬到当前 scrollHeight 作为动画起点。
   * @param el 即将做收起过渡的元素；dataset 缺失时先补建，避免暂存值丢失。
   */
  beforeLeave(el: RendererElement) {
    if (!el.dataset) el.dataset = {};
    el.dataset.oldPaddingTop = el.style.paddingTop;
    el.dataset.oldMarginTop = el.style.marginTop;
    el.dataset.oldPaddingBottom = el.style.paddingBottom;
    el.dataset.oldMarginBottom = el.style.marginBottom;
    el.dataset.oldOverflow = el.style.overflow;
    el.style.maxHeight = `${el.scrollHeight}px`;
    el.style.overflow = 'hidden';
  },

  /**
   * 展开动画中在下一帧把 maxHeight 抬到目标高度，并恢复四向内外边距、保持 overflow 为 hidden。
   * 目标高度优先取进入前记下的固定高度，其次取实时 scrollHeight，内容高度为 0 时维持 0 不动画。
   * @param el 正在做展开过渡的元素。
   */
  enter(el: RendererElement) {
    requestAnimationFrame(() => {
      el.dataset.oldOverflow = el.style.overflow;
      if (el.dataset.elExistsHeight) {
        el.style.maxHeight = el.dataset.elExistsHeight;
      } else if (el.scrollHeight === 0) {
        el.style.maxHeight = 0;
      } else {
        el.style.maxHeight = `${el.scrollHeight}px`;
      }

      el.style.paddingTop = el.dataset.oldPaddingTop;
      el.style.paddingBottom = el.dataset.oldPaddingBottom;
      el.style.marginTop = el.dataset.oldMarginTop;
      el.style.marginBottom = el.dataset.oldMarginBottom;
      el.style.overflow = 'hidden';
    });
  },

  /**
   * 展开动画被中断时走收尾逻辑，避免元素停留在半展开的 maxHeight 上。
   * @param el 展开被取消的元素。
   */
  enterCancelled(el: RendererElement) {
    reset(el);
  },

  /**
   * 收起动画中把 maxHeight 与四向内外边距压到 0，实现高度归零的收起效果。
   * @param el 正在做收起过渡的元素；scrollHeight 为 0 表示内容已不可见，此时保持现状不动。
   */
  leave(el: RendererElement) {
    if (el.scrollHeight !== 0) {
      el.style.maxHeight = 0;
      el.style.paddingTop = 0;
      el.style.paddingBottom = 0;
      el.style.marginTop = 0;
      el.style.marginBottom = 0;
    }
  },

  /**
   * 收起动画被中断时走收尾逻辑，把样式还原到进入收起过渡之前的状态。
   * @param el 收起被取消的元素。
   */
  leaveCancelled(el: RendererElement) {
    reset(el);
  },
};
</script>

<template>
  <transition name="collapse-transition" v-on="on">
    <slot></slot>
  </transition>
</template>

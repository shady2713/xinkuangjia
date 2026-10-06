/**
 * 回到顶部组合式函数：在 document 或 target 指定元素上
 * 节流监听滚动，暴露 visible 与 handleClick 平滑回顶。
 * 目标选择器取不到元素时直接抛错，不做降级兜底。
 */
import type { BacktopProps } from './backtop';

import { onMounted, ref, shallowRef } from 'vue';

import { useEventListener, useThrottleFn } from '@vueuse/core';

/**
 * 组合式函数：在 document 或 target 指定的元素上节流监听滚动，按 visibilityHeight
 * 维护按钮显隐，并交出平滑回顶的点击处理。滚动容器在 onMounted 里才确定，
 * 此前 visible 恒为 false；target 非空却查不到元素时直接抛错，不做降级兜底。
 * @param props 回到顶部按钮的属性契约；只读取 target 与 visibilityHeight，后者缺失按 0 比较。
 * @returns 点击回顶的 handleClick 与表示显隐的 visible ref，调用方直接绑定到模板。
 */
export const useBackTop = (props: BacktopProps) => {
  const el = shallowRef<HTMLElement>();
  const container = shallowRef<Document | HTMLElement>();
  const visible = ref(false);

  /**
   * 滚动回调：比较容器当前 scrollTop 与阈值来切换 visible，容器元素尚未就绪时什么都不做。
   * 挂载完成时也会主动调用一次，让按钮初始显隐与页面位置一致。
   */
  const handleScroll = () => {
    if (el.value) {
      visible.value = el.value.scrollTop >= (props?.visibilityHeight ?? 0);
    }
  };

  /** 点击回调：对当前滚动容器发起平滑回顶；容器元素尚未就绪时静默忽略。 */
  const handleClick = () => {
    el.value?.scrollTo({ behavior: 'smooth', top: 0 });
  };

  const handleScrollThrottled = useThrottleFn(handleScroll, 300, true);

  useEventListener(container, 'scroll', handleScrollThrottled);
  onMounted(() => {
    container.value = document;
    el.value = document.documentElement;

    if (props.target) {
      el.value = document.querySelector<HTMLElement>(props.target) ?? undefined;

      if (!el.value) {
        throw new Error(`target does not exist: ${props.target}`);
      }
      container.value = el.value;
    }
    // Give visible an initial value, fix #13066
    handleScroll();
  });

  return {
    handleClick,
    visible,
  };
};

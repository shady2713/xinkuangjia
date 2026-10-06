/**
 * 标签页横向滚动组合式函数：维护滚动按钮显隐、左右到达状态与激活项可见性。
 * 用 ResizeObserver 跟踪尺寸变化，
 * 用 MutationObserver 跟踪标签数量增减；
 * 对外暴露 scrollDirection 与 handleWheel 等入口，
 * 不负责标签数据与路由切换。
 */
import type { TabsProps } from './types';

import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { VbenScrollbar } from '@vben-core/shadcn-ui';

import { useDebounceFn } from '@vueuse/core';

/** 滚动视口的取值域：元素尚未挂载时是 null 或 undefined，调用方必须先判空再用。 */
type DomElement = Element | null | undefined;

/**
 * 标签栏横向滚动的组合式函数：维护滚动按钮显隐、左右到达边界与激活项可见性。
 * 挂载时定位视口并挂上尺寸与子节点监听，样式切换时重建；视口取不到时各入口都直接跳过。
 * @param props 标签栏渲染属性，只读取 active、tabs 与 styleType 作为响应来源。
 * @returns 滚动条 ref、左右滚动入口、滚轮入口、左右边界状态与滚动按钮显隐状态。
 */
export function useTabsViewScroll(props: TabsProps) {
  let resizeObserver: null | ResizeObserver = null;
  let mutationObserver: MutationObserver | null = null;
  let tabItemCount = 0;
  const scrollbarRef = ref<InstanceType<typeof VbenScrollbar> | null>(null);
  const scrollViewportEl = ref<DomElement>(null);
  const showScrollButton = ref(false);
  const scrollIsAtLeft = ref(true);
  const scrollIsAtRight = ref(false);

  /**
   * 读取滚动条与视口的可视宽度：任一元素尚未挂载时返回空对象，
   * 调用方据此判定宽度不可用，跳过本次宽度相关的计算。
   */
  function getScrollClientWidth() {
    const scrollbarEl = scrollbarRef.value?.$el;
    if (!scrollbarEl || !scrollViewportEl.value) return {};

    const scrollbarWidth = scrollbarEl.clientWidth;
    const scrollViewWidth = scrollViewportEl.value.clientWidth;

    return {
      scrollbarWidth,
      scrollViewWidth,
    };
  }

  /**
   * 按方向横向滚动一段：实际位移是可视宽度减去 distance，单次滚动因此留有边距。
   * 宽度读不到，或滚动条根容器比视口还宽时直接返回，不产生任何位移。
   * @param direction 滚动方向，left 向左、right 向右。
   * @param distance 位移时预留的边距，值越大单次滚动距离越短。
   */
  function scrollDirection(
    direction: 'left' | 'right',
    distance: number = 150,
  ) {
    const { scrollbarWidth, scrollViewWidth } = getScrollClientWidth();

    if (!scrollbarWidth || !scrollViewWidth) return;

    if (scrollbarWidth > scrollViewWidth) return;

    scrollViewportEl.value?.scrollBy({
      behavior: 'smooth',
      left:
        direction === 'left'
          ? -(scrollbarWidth - distance)
          : +(scrollbarWidth - distance),
    });
  }

  /**
   * 初始化滚动区：定位视口元素、算出滚动按钮显隐并把激活项滚入视野，
   * 随后挂上尺寸变化与子节点增减两个监听。样式切换时重复调用会先断开旧监听再重建；
   * 滚动条元素还没渲染出来时直接结束，不注册任何监听。
   */
  async function initScrollbar() {
    await nextTick();

    const scrollbarEl = scrollbarRef.value?.$el;
    if (!scrollbarEl) {
      return;
    }

    const viewportEl = scrollbarEl?.querySelector(
      'div[data-reka-scroll-area-viewport]',
    );

    scrollViewportEl.value = viewportEl;
    calcShowScrollbarButton();

    await nextTick();
    scrollToActiveIntoView();

    // 监听大小变化
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(
      useDebounceFn((_entries: ResizeObserverEntry[]) => {
        calcShowScrollbarButton();
        scrollToActiveIntoView();
      }, 100),
    );
    resizeObserver.observe(viewportEl);

    tabItemCount = props.tabs?.length || 0;
    mutationObserver?.disconnect();
    // 使用 MutationObserver 仅监听子节点数量变化
    mutationObserver = new MutationObserver(() => {
      const count = viewportEl.querySelectorAll(
        `div[data-tab-item="true"]`,
      ).length;

      if (count > tabItemCount) {
        scrollToActiveIntoView();
      }

      if (count !== tabItemCount) {
        calcShowScrollbarButton();
        tabItemCount = count;
      }
    });

    // 配置为仅监听子节点的添加和移除
    mutationObserver.observe(viewportEl, {
      attributes: false,
      childList: true,
      subtree: true,
    });
  }

  /**
   * 把激活标签横向滚入视野：先等一次更新拿到稳定布局，再在下一帧调用 scrollIntoView。
   * 视口未就绪，或内容宽度还没超过可视宽度时不做任何处理。
   */
  async function scrollToActiveIntoView() {
    if (!scrollViewportEl.value) {
      return;
    }
    await nextTick();
    const viewportEl = scrollViewportEl.value;
    const { scrollbarWidth } = getScrollClientWidth();
    const { scrollWidth } = viewportEl;

    if (scrollbarWidth >= scrollWidth) {
      return;
    }

    requestAnimationFrame(() => {
      const activeItem = viewportEl?.querySelector('.is-active');
      activeItem?.scrollIntoView({ behavior: 'smooth', inline: 'start' });
    });
  }

  /**
   * 计算tabs 宽度，用于判断是否显示左右滚动按钮
   */
  async function calcShowScrollbarButton() {
    if (!scrollViewportEl.value) {
      return;
    }

    const { scrollbarWidth } = getScrollClientWidth();

    showScrollButton.value =
      scrollViewportEl.value.scrollWidth > scrollbarWidth;
  }

  /** 滚动位置变化时更新左右到达边界，供模板决定左右滚动按钮是否置灰；100ms 防抖避免连续滚动反复写状态。 */
  const handleScrollAt = useDebounceFn(({ left, right }) => {
    scrollIsAtLeft.value = left;
    scrollIsAtRight.value = right;
  }, 100);

  /** 滚轮转横向位移：把纵向滚动量放大三倍写入视口，视口未就绪时忽略本次事件。 */
  function handleWheel({ deltaY }: WheelEvent) {
    scrollViewportEl.value?.scrollBy({
      // behavior: 'smooth',
      left: deltaY * 3,
    });
  }

  watch(
    () => props.active,
    async () => {
      // 200为了等待 tab 切换动画完成
      // setTimeout(() => {
      scrollToActiveIntoView();
      // }, 300);
    },
    {
      flush: 'post',
    },
  );

  // watch(
  //   () => props.tabs?.length,
  //   async () => {
  //     await nextTick();
  //     calcShowScrollbarButton();
  //   },
  //   {
  //     flush: 'post',
  //   },
  // );

  watch(
    () => props.styleType,
    () => {
      initScrollbar();
    },
  );

  onMounted(initScrollbar);

  onUnmounted(() => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
  });

  return {
    handleScrollAt,
    handleWheel,
    initScrollbar,
    scrollbarRef,
    scrollDirection,
    scrollIsAtLeft,
    scrollIsAtRight,
    showScrollButton,
  };
}

<script setup lang="ts">
/**
 * 滚动容器组件：包裹底层滚动区域，接近边缘时按需显示方向阴影。
 * horizontal 控制横向滚动条，shadow 系列属性决定各方向阴影。
 * 通过 scrollAt 上报四方向是否到达边界，不接管滚动位置。
 */
import type { ClassType } from '@vben-core/typings';

import { computed, ref } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ScrollArea, ScrollBar } from '../../ui';

/**
 * 滚动容器的入参。
 * class 给滚动区域，scrollBarClass 给横向滚动条；horizontal 为真时才渲染横向滚动条。
 * shadow 是阴影的总开关，只有它为真时 shadowTop、shadowBottom、shadowLeft、shadowRight
 * 四个方向开关才各自生效；shadowBorder 让已显示的阴影额外带一条边框。
 */
interface Props {
  class?: ClassType;
  horizontal?: boolean;
  scrollBarClass?: ClassType;
  shadow?: boolean;
  shadowBorder?: boolean;
  shadowBottom?: boolean;
  shadowLeft?: boolean;
  shadowRight?: boolean;
  shadowTop?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  class: '',
  horizontal: false,
  shadow: false,
  shadowBorder: false,
  shadowBottom: true,
  shadowLeft: false,
  shadowRight: false,
  shadowTop: true,
});

const emit = defineEmits<{
  scrollAt: [{ bottom: boolean; left: boolean; right: boolean; top: boolean }];
}>();

const isAtTop = ref(true);
const isAtRight = ref(false);
const isAtBottom = ref(false);
const isAtLeft = ref(true);

/**
 * We have to check if the scroll amount is close enough to some threshold in order to
 * more accurately calculate arrivedState. This is because scrollTop/scrollLeft are non-rounded
 * numbers, while scrollHeight/scrollWidth and clientHeight/clientWidth are rounded.
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight#determine_if_an_element_has_been_totally_scrolled
 */
const ARRIVED_STATE_THRESHOLD_PIXELS = 1;

/**
 * 顶部渐隐遮罩是否渲染，等价于总开关 shadow 与方向开关 shadowTop 同时为真。
 * 真正决定遮罩出不出现的是 isAtTop：滚到顶部就淡出，因此这里只管"允许不允许"。
 */
const showShadowTop = computed(() => props.shadow && props.shadowTop);
/** 底部渐隐遮罩是否渲染，语义同上，对应方向开关是 shadowBottom。 */
const showShadowBottom = computed(() => props.shadow && props.shadowBottom);
/** 左侧渐隐遮罩是否渲染，语义同上，对应方向开关是 shadowLeft。 */
const showShadowLeft = computed(() => props.shadow && props.shadowLeft);
/** 右侧渐隐遮罩是否渲染，语义同上，对应方向开关是 shadowRight。 */
const showShadowRight = computed(() => props.shadow && props.shadowRight);

/**
 * 横向两端的遮罩类名。
 * 两端都没到边界且左右阴影都开启时用 both-shadow，让样式对左右同时生效；
 * 只在单侧需要时给对应方向的类名，两侧都关时返回空集合、不加任何遮罩样式。
 */
const computedShadowClasses = computed(() => {
  return {
    'both-shadow':
      !isAtLeft.value &&
      !isAtRight.value &&
      showShadowLeft.value &&
      showShadowRight.value,
    'left-shadow': !isAtLeft.value && showShadowLeft.value,
    'right-shadow': !isAtRight.value && showShadowRight.value,
  };
});

/**
 * 每次滚动后重新判断四方向是否已到达边界，并连同结果抛出 scrollAt 事件。
 * 起点方向直接以偏移为 0 判定；终点方向因为 scrollTop/scrollHeight 与 clientHeight 的精度不一致，
 * 留了 ARRIVED_STATE_THRESHOLD_PIXELS 的容差，否则滚到底也常差一点判不到。
 * 事件只做上报，不修改滚动位置，也不拦截默认滚动行为。
 * @param event 滚动事件，target 即发生滚动的元素。
 */
function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  const scrollTop = target?.scrollTop ?? 0;
  const scrollLeft = target?.scrollLeft ?? 0;
  const clientHeight = target?.clientHeight ?? 0;
  const clientWidth = target?.clientWidth ?? 0;
  const scrollHeight = target?.scrollHeight ?? 0;
  const scrollWidth = target?.scrollWidth ?? 0;
  isAtTop.value = scrollTop <= 0;
  isAtLeft.value = scrollLeft <= 0;
  isAtBottom.value =
    Math.abs(scrollTop) + clientHeight >=
    scrollHeight - ARRIVED_STATE_THRESHOLD_PIXELS;
  isAtRight.value =
    Math.abs(scrollLeft) + clientWidth >=
    scrollWidth - ARRIVED_STATE_THRESHOLD_PIXELS;

  emit('scrollAt', {
    bottom: isAtBottom.value,
    left: isAtLeft.value,
    right: isAtRight.value,
    top: isAtTop.value,
  });
}
</script>

<template>
  <ScrollArea
    :class="[cn(props.class), computedShadowClasses]"
    :on-scroll="handleScroll"
    class="vben-scrollbar relative"
  >
    <div
      v-if="showShadowTop"
      :class="{
        'opacity-100': !isAtTop,
        'border-t border-border': shadowBorder && !isAtTop,
      }"
      class="scrollbar-top-shadow pointer-events-none absolute top-0 z-10 h-12 w-full opacity-0 transition-opacity duration-300 ease-in-out will-change-[opacity]"
    ></div>
    <slot></slot>
    <div
      v-if="showShadowBottom"
      :class="{
        'opacity-100': !isAtTop && !isAtBottom,
        'border-b border-border': shadowBorder && !isAtTop && !isAtBottom,
      }"
      class="scrollbar-bottom-shadow pointer-events-none absolute bottom-0 z-10 h-12 w-full opacity-0 transition-opacity duration-300 ease-in-out will-change-[opacity]"
    ></div>
    <ScrollBar
      v-if="horizontal"
      :class="scrollBarClass"
      orientation="horizontal"
    />
  </ScrollArea>
</template>

<style scoped>
.vben-scrollbar {
  &:not(.both-shadow).left-shadow {
    mask-image: linear-gradient(90deg, transparent, #000 16px);
  }

  &:not(.both-shadow).right-shadow {
    mask-image: linear-gradient(
      90deg,
      #000 0%,
      #000 calc(100% - 16px),
      transparent
    );
  }

  &.both-shadow {
    mask-image: linear-gradient(
      90deg,
      transparent,
      #000 16px,
      #000 calc(100% - 16px),
      transparent 100%
    );
  }
}

.scrollbar-top-shadow {
  background: linear-gradient(
    to bottom,
    hsl(var(--scroll-shadow, var(--background))),
    transparent
  );
}

.scrollbar-bottom-shadow {
  background: linear-gradient(
    to top,
    hsl(var(--scroll-shadow, var(--background))),
    transparent
  );
}
</style>

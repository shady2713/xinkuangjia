<script setup lang="ts">
/**
 * 滚动容器：包裹内容视口并固定挂载纵向滚动条与角落补块。
 * onScroll 事件透传给使用方，滚动条外观由 ScrollBar 提供。
 */
import type { ScrollAreaRootProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaViewport } from 'reka-ui';

import ScrollBar from './ScrollBar.vue';

const props = withDefaults(
  defineProps<
    {
      class?: ClassValue;
      /** 视口滚动的回调，收到原生 scroll 事件；不传时由 withDefaults 填入空函数占位。 */
      onScroll?: (event: Event) => void;
      /**
       * 视口额外属性的声明位：本组件的脚本与模板都不读取它，视口滚动直接绑定顶层 onScroll；
       * 该字段随 delegatedProps 透传给 ScrollAreaRoot，而 reka-ui 未声明该 prop，因此不会作用到视口。
       */
      viewportProps?: { /** 未被组件消费 */ onScroll: (event: Event) => void };
    } & ScrollAreaRootProps
  >(),
  {
    /** onScroll 的兜底实现：空函数，保证未传回调时模板上的监听绑定仍能安全挂载。 */
    onScroll: () => {},
  },
);

/** 剔除 class 后的根属性集合，其余属性原样转交 ScrollAreaRoot；视口滚动事件由模板直接挂载，不走这里。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;
  return delegated;
});
</script>

<template>
  <ScrollAreaRoot
    v-bind="delegatedProps"
    :class="cn('relative overflow-hidden', props.class)"
  >
    <ScrollAreaViewport
      as-child
      class="h-full w-full rounded-[inherit] focus:outline-none"
      @scroll="onScroll"
    >
      <slot></slot>
    </ScrollAreaViewport>
    <ScrollBar />
    <ScrollAreaCorner />
  </ScrollAreaRoot>
</template>

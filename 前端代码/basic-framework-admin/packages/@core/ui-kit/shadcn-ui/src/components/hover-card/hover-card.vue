<script setup lang="ts">
/**
 * 悬停卡片：鼠标移入触发区后弹出内容浮层，trigger 与默认插槽分别承载两端。
 * 菜单折叠态的子菜单浮层用它展示下一级；组件只透传 reka-ui 的属性与事件，
 * 浮层内容、显隐时机与层级样式由使用方决定。
 */
import type {
  HoverCardContentProps,
  HoverCardRootEmits,
  HoverCardRootProps,
} from 'reka-ui';

import type { ClassType } from '@vben-core/typings';

import { computed } from 'vue';

import { useForwardPropsEmits } from 'reka-ui';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../ui';

interface Props extends HoverCardRootProps {
  class?: ClassType;
  contentClass?: ClassType;
  contentProps?: HoverCardContentProps;
}

const props = defineProps<Props>();

const emits = defineEmits<HoverCardRootEmits>();

const delegatedProps = computed(() => {
  const {
    class: _cls,
    contentClass: _,
    contentProps: _cProps,
    ...delegated
  } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <HoverCard v-bind="forwarded">
    <HoverCardTrigger as-child class="h-full">
      <div class="h-full cursor-pointer">
        <slot name="trigger"></slot>
      </div>
    </HoverCardTrigger>
    <HoverCardContent
      :class="contentClass"
      v-bind="contentProps"
      class="side-content z-popup"
    >
      <slot></slot>
    </HoverCardContent>
  </HoverCard>
</template>

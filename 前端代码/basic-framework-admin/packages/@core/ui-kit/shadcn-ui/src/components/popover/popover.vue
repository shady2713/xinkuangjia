<script setup lang="ts">
/**
 * 气泡浮层组件：包装 reka-ui 的 Popover，补齐插槽与类名入口。
 * 触发器与内容区样式可分别定制，根属性、事件原样透传。
 * 显隐与关闭状态由 reka-ui 和使用方掌握，本组件不额外托管。
 */
import type {
  PopoverContentProps,
  PopoverRootEmits,
  PopoverRootProps,
} from 'reka-ui';

import type { ClassType } from '@vben-core/typings';

import { computed } from 'vue';

import { useForwardPropsEmits } from 'reka-ui';

import {
  PopoverContent,
  Popover as PopoverRoot,
  PopoverTrigger,
} from '../../ui';

/**
 * 气泡浮层的入参：透传 reka-ui 根组件属性，并补三项只由本组件消费的样式入口——
 * triggerClass 给触发器、contentClass 给内容浮层、contentProps 原样转交内容浮层，
 * class 预留给使用方在根节点上做覆盖。
 */
interface Props extends PopoverRootProps {
  class?: ClassType;
  contentClass?: ClassType;
  contentProps?: PopoverContentProps;
  triggerClass?: ClassType;
}

const props = withDefaults(defineProps<Props>(), {});

const emits = defineEmits<PopoverRootEmits>();

/**
 * 需要转交给底层 Popover 根组件的属性集合，剔除了只在本组件内部消费的三项样式/内容属性。
 * 剔除后连同 emits 一起交给 useForwardPropsEmits，使显隐与开关状态仍由使用方掌控。
 */
const delegatedProps = computed(() => {
  const {
    class: _cls,
    contentClass: _,
    contentProps: _cProps,
    triggerClass: _tClass,
    ...delegated
  } = props;

  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <PopoverRoot v-bind="forwarded">
    <PopoverTrigger :class="triggerClass">
      <slot name="trigger"></slot>

      <PopoverContent
        :class="contentClass"
        class="side-content z-popup"
        v-bind="contentProps"
      >
        <slot></slot>
      </PopoverContent>
    </PopoverTrigger>
  </PopoverRoot>
</template>

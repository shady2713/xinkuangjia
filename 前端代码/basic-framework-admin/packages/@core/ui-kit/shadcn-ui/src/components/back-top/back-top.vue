<script lang="ts" setup>
/**
 * 回到顶部按钮：滚动超过阈值后浮出，点击平滑回顶。
 * 位置由 bottom、right 决定，监听与显隐判定在 useBackTop，
 * 组件自身不解析目标容器。
 */
import type { BacktopProps } from './backtop';

import { computed } from 'vue';

import { ArrowUpToLine } from '@vben-core/icons';

import { VbenButton } from '../button';
import { useBackTop } from './use-backtop';

/** 回到顶部按钮的属性契约别名：直接复用按钮属性，不额外声明成员。 */
type Props = BacktopProps;

defineOptions({ name: 'BackTop' });

const props = withDefaults(defineProps<Props>(), {
  bottom: 20,
  isGroup: false,
  right: 24,
  target: '',
  visibilityHeight: 200,
});

const backTopStyle = computed(() => ({
  bottom: `${props.bottom}px`,
  right: `${props.right}px`,
}));

const { handleClick, visible } = useBackTop(props);
</script>
<template>
  <transition name="fade-down">
    <VbenButton
      v-if="visible"
      :style="backTopStyle"
      class="data z-popup shadow-float fixed bottom-10 size-10 rounded-full bg-background duration-500 hover:bg-heavy dark:bg-accent dark:hover:bg-heavy"
      size="icon"
      variant="icon"
      @click="handleClick"
    >
      <ArrowUpToLine class="size-4" />
    </VbenButton>
  </transition>
</template>

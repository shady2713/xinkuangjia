<script lang="ts" setup>
/**
 * 带背景折角样式的一体式面包屑：用内联 ul/li 渲染层级，
 * 点击非末级项向外 emit select 路径。
 * 末级仅展示，不负责路由跳转与层级计算。
 */
import type { BreadcrumbProps } from './types';

import { VbenIcon } from '../icon';

/** 带背景面包屑的属性契约别名：直接复用面包屑属性，不额外声明成员。 */
type Props = BreadcrumbProps;

defineOptions({ name: 'Breadcrumb' });
const { breadcrumbs, showIcon } = defineProps<Props>();

const emit = defineEmits<{ select: [string] }>();

/**
 * 抛出被点击层级的路径，交由调用方决定跳转：末级是当前页、留空 path 的占位层级都直接返回，
 * 避免把用户送回当前页或跳到空地址。
 */
function handleClick(index: number, path?: string) {
  if (!path || index === breadcrumbs.length - 1) {
    return;
  }
  emit('select', path);
}
</script>
<template>
  <ul class="flex">
    <TransitionGroup name="breadcrumb-transition">
      <template
        v-for="(item, index) in breadcrumbs"
        :key="`${item.path}-${item.title}-${index}`"
      >
        <li>
          <a
            href="javascript:void 0"
            @click.stop="handleClick(index, item.path)"
          >
            <span class="flex-center z-10 h-full">
              <VbenIcon
                v-if="showIcon"
                :icon="item.icon"
                class="mr-1 size-4 flex-shrink-0"
              />
              <span
                :class="{
                  'font-normal text-foreground':
                    index === breadcrumbs.length - 1,
                }"
                >{{ item.title }}
              </span>
            </span>
          </a>
        </li>
      </template>
    </TransitionGroup>
  </ul>
</template>
<style scoped>
li {
  @apply h-7;
}

li a {
  @apply relative mr-9 flex h-7 items-center bg-accent py-0 pl-[5px] pr-2 text-[13px] text-muted-foreground;
}

li a > span {
  @apply -ml-3;
}

li:first-child a > span {
  @apply -ml-1;
}

li:first-child a {
  @apply rounded-[4px_0_0_4px] pl-[15px];
}

li:first-child a::before {
  @apply border-none;
}

li:last-child a {
  @apply rounded-[0_4px_4px_0] pr-[15px];
}

li:last-child a::after {
  @apply border-none;
}

li a::before,
li a::after {
  @apply absolute top-0 h-0 w-0 border-[.875rem] border-solid border-accent content-[''];
}

li a::before {
  @apply -left-7 z-10 border-l-transparent;
}

li a::after {
  @apply left-full border-transparent border-l-accent;
}

li:not(:last-child) a:hover {
  @apply bg-accent-hover;
}

li:not(:last-child) a:hover::before {
  @apply border-accent-hover border-l-transparent;
}

li:not(:last-child) a:hover::after {
  @apply border-l-accent-hover;
}
</style>

<script setup lang="ts">
/**
 * 页签列表容器：把一组触发件排成一行，提供灰底圆角内衬的容器外观。
 * 溢出滚动、可关闭标签等页签条行为由 segmented 与 tabs-ui 另行封装。
 */
import type { TabsListProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { TabsList } from 'reka-ui';

const props = defineProps<TabsListProps & { class?: ClassValue }>();

/** 去掉 class 后的页签容器属性，转交 TabsList，让 reka-ui 接管方向键在触发件间移动焦点。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <TabsList
    v-bind="delegatedProps"
    :class="
      cn(
        'inline-flex h-9 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground',
        props.class,
      )
    "
  >
    <slot></slot>
  </TabsList>
</template>

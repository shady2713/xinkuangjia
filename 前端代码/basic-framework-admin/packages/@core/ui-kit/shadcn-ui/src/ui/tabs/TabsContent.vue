<script setup lang="ts">
/**
 * 页签内容面板：承载某个触发件对应的内容，默认带顶部间距与焦点环。
 * 显隐与切换由 TabsRoot 控制，本组件只转发属性并合并调用方 class。
 */
import type { TabsContentProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { TabsContent } from 'reka-ui';

const props = defineProps<TabsContentProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <TabsContent
    :class="
      cn(
        'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        props.class,
      )
    "
    v-bind="delegatedProps"
  >
    <slot></slot>
  </TabsContent>
</template>

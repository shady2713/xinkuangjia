<script setup lang="ts">
/**
 * 页签触发件：单个可点击页签，激活态换底色与阴影，禁用态屏蔽点击。
 * 用 useForwardProps 透传属性，不负责内容渲染与页签增删。
 */
import type { TabsTriggerProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { TabsTrigger, useForwardProps } from 'reka-ui';

const props = defineProps<TabsTriggerProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});

const forwardedProps = useForwardProps(delegatedProps);
</script>

<template>
  <TabsTrigger
    v-bind="forwardedProps"
    :class="
      cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
        props.class,
      )
    "
  >
    <slot></slot>
  </TabsTrigger>
</template>

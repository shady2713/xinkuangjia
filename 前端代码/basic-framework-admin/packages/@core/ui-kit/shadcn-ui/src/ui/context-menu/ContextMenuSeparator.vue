<script setup lang="ts">
/** 右键菜单分隔线：一条贯穿菜单宽度的细线，用于切分动作分组，不可交互。 */
import type { ContextMenuSeparatorProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { ContextMenuSeparator } from 'reka-ui';

const props = defineProps<ContextMenuSeparatorProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <ContextMenuSeparator
    v-bind="delegatedProps"
    :class="cn('-mx-1 my-1 h-px bg-border', props.class)"
  />
</template>

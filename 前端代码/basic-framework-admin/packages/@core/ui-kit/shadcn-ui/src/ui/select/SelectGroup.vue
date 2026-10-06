<script setup lang="ts">
/** 选项分组容器：为同组选项提供统一内边距与分组语义，不参与选中。 */
import type { SelectGroupProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { SelectGroup } from 'reka-ui';

const props = defineProps<SelectGroupProps & { class?: ClassValue }>();

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <SelectGroup :class="cn('w-full p-1', props.class)" v-bind="delegatedProps">
    <slot></slot>
  </SelectGroup>
</template>

<script setup lang="ts">
/** 菜单分隔线：在菜单项之间画一条浅色横线，只做视觉分组，不参与交互。 */
import type { DropdownMenuSeparatorProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { DropdownMenuSeparator } from 'reka-ui';

const props = defineProps<
  DropdownMenuSeparatorProps & {
    class?: ClassValue;
  }
>();

/** 去掉 class 后的分隔线属性，转交 DropdownMenuSeparator 作为纯展示节点，不参与键盘导航。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <DropdownMenuSeparator
    v-bind="delegatedProps"
    :class="cn('-mx-1 my-1 h-px bg-border', props.class)"
  />
</template>

<script lang="ts" setup>
/** 表单项容器：把标签、控件与说明组合成一个可校验的表单项。 */
import type { ClassValue } from '@vben-core/shared/utils';

import { provide, useId } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { FORM_ITEM_INJECTION_KEY } from './injectionKeys';

const props = defineProps<{
  class?: ClassValue;
}>();

const id = useId() as string;
provide(FORM_ITEM_INJECTION_KEY, id);
</script>

<template>
  <div :class="cn(props.class)">
    <slot></slot>
  </div>
</template>

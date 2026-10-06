<script lang="ts" setup>
/**
 * 面包屑链接：以 a 为默认载体渲染可跳转的中间层级。
 * 只提供悬停配色与多态标签，当前页与非链接层级由 Page、Item 承担。
 */
import type { PrimitiveProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { cn } from '@vben-core/shared/utils';

import { Primitive } from 'reka-ui';

const props = withDefaults(
  defineProps<PrimitiveProps & { class?: ClassValue }>(),
  {
    as: 'a',
  },
);
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn('transition-colors hover:text-foreground', props.class)"
  >
    <slot></slot>
  </Primitive>
</template>

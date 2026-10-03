<script setup lang="ts">
/** 头像容器：按尺寸与形状渲染头像根节点，并允许外部 class 覆盖默认样式。 */
import type { ClassValue } from '@vben-core/shared/utils';

import type { AvatarVariants } from './avatar';

import { cn } from '@vben-core/shared/utils';

import { AvatarRoot } from 'reka-ui';

import { avatarVariant } from './avatar';

const props = withDefaults(
  defineProps<{
    class?: ClassValue;
    shape?: AvatarVariants['shape'];
    size?: AvatarVariants['size'];
  }>(),
  {
    shape: 'circle',
    size: 'sm',
  },
);
</script>

<template>
  <AvatarRoot :class="cn(avatarVariant({ size, shape }), props.class)">
    <slot></slot>
  </AvatarRoot>
</template>

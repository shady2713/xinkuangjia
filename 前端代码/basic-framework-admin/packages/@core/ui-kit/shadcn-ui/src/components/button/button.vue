<script setup lang="ts">
/**
 * 基础按钮：用 reka-ui Primitive 渲染，
 * 按 variant 与 size 套用样式类，
 * loading 时禁止点击并显示旋转图标。
 * 不做权限判断与异步提交，提交逻辑归调用方。
 */
import type { VbenButtonProps } from './button';

import { computed } from 'vue';

import { LoaderCircle } from '@vben-core/icons';
import { cn } from '@vben-core/shared/utils';

import { Primitive } from 'reka-ui';

import { buttonVariants } from '../../ui';

/** 业务按钮的属性契约别名：直接复用按钮属性，不额外声明成员。 */
type Props = VbenButtonProps;

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  class: '',
  disabled: false,
  loading: false,
  size: 'default',
  variant: 'default',
});

const isDisabled = computed(() => {
  return props.disabled || props.loading;
});
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
    :disabled="isDisabled"
  >
    <LoaderCircle
      v-if="loading"
      class="text-md mr-2 size-4 flex-shrink-0 animate-spin"
    />
    <slot></slot>
  </Primitive>
</template>

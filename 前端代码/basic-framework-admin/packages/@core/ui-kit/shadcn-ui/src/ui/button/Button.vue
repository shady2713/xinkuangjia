<script setup lang="ts">
/**
 * 按钮基座：默认渲染原生 button，保留键盘操作与表单提交语义。
 * 可通过 as、asChild 换用其他标签，加载态与图标由上层按钮组件补齐。
 */
import type { PrimitiveProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import type { ButtonVariants, ButtonVariantSize } from './types';

import { cn } from '@vben-core/shared/utils';

import { Primitive } from 'reka-ui';

import { buttonVariants } from './button';

interface Props extends PrimitiveProps {
  class?: ClassValue;
  size?: ButtonVariantSize;
  variant?: ButtonVariants;
}

const props = withDefaults(defineProps<Props>(), {
  as: 'button',
  class: '',
});
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    :class="cn(buttonVariants({ variant, size }), props.class)"
  >
    <slot></slot>
  </Primitive>
</template>

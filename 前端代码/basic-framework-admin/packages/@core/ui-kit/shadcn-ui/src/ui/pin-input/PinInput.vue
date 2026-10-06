<script setup lang="ts">
/**
 * 验证码输入根节点：横向排布各格并透传属性与完成事件。
 * 校验、倒计时与提交由使用方处理，本件只同步 reka-ui 的输入状态。
 */
import type { PinInputRootEmits, PinInputRootProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { PinInputRoot, useForwardPropsEmits } from 'reka-ui';

const props = defineProps<PinInputRootProps & { class?: ClassValue }>();
const emits = defineEmits<PinInputRootEmits>();

/** 去掉 class 后的验证码根节点属性，连同 emits 转发给 PinInputRoot；输入编排与完成时机由底层决定。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;
  return delegated;
});

const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <PinInputRoot
    v-bind="forwarded"
    :class="cn('flex items-center gap-2', props.class)"
  >
    <slot></slot>
  </PinInputRoot>
</template>

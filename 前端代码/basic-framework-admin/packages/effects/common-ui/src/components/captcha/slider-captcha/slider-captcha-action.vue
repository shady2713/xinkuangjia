<script setup lang="ts">
/**
 * 滑块验证码的拖动手柄：渲染滑块与右箭头、对勾图标，
 * 按父级推入的位移移动，并对外暴露根元素与样式查询。
 * 位移计算与通过判定在基座组件，本组件只管展示与拖动外观。
 */
import type { CSSProperties } from 'vue';

import { computed, ref, useTemplateRef } from 'vue';

import { Check, ChevronsRight } from '@vben/icons';

import { Slot } from '@vben-core/shadcn-ui';

const props = defineProps<{
  actionStyle: CSSProperties;
  isPassing: boolean;
  toLeft: boolean;
}>();

const actionRef = useTemplateRef<HTMLDivElement>('actionRef');

const left = ref('0');

/** 滑块的最终样式：调用方传入的样式叠加当前横向偏移。 */
const style = computed(() => {
  const { actionStyle } = props;
  return {
    ...actionStyle,
    left: left.value,
  };
});

/** 是否处于拖动中：偏移超过 10px 且尚未通过时成立，用于切换圆角外观。 */
const isDragging = computed(() => {
  const currentLeft = Number.parseInt(left.value as string);

  return currentLeft > 10 && !props.isPassing;
});

defineExpose({
  /** 返回滑块根元素；尚未挂载时为 null。 */
  getEl: () => {
    return actionRef.value;
  },
  /** 返回滑块根元素的行内样式对象，供父级读取当前 left 值。 */
  getStyle: () => {
    return actionRef?.value?.style;
  },
  /** 设置滑块的横向偏移，取值为形如 '12px' 的字符串。 */
  setLeft: (val: string) => {
    left.value = val;
  },
});
</script>

<template>
  <div
    ref="actionRef"
    :class="{
      'transition-width !left-0 duration-300': toLeft,
      'rounded-md': isDragging,
    }"
    :style="style"
    class="bg-background dark:bg-accent absolute left-0 top-0 flex h-full cursor-move items-center justify-center px-3.5 shadow-md"
    name="captcha-action"
  >
    <Slot :is-passing="isPassing" class="text-foreground/60 size-4">
      <slot name="icon">
        <ChevronsRight v-if="!isPassing" />
        <Check v-else />
      </slot>
    </Slot>
  </div>
</template>

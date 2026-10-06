<script setup lang="ts">
/**
 * 通用分隔线：按 orientation 渲染横向或纵向细线，传入 label 时把文字压在线的中央。
 * 抽屉页头、个人资料页与表单区块用它切分版面，除自身尺寸外不参与外层布局约束。
 */
import type { SeparatorProps } from 'reka-ui';

import type { ClassValue } from '@vben-core/shared/utils';

import { computed } from 'vue';

import { cn } from '@vben-core/shared/utils';

import { Separator } from 'reka-ui';

const props = defineProps<
  SeparatorProps & { class?: ClassValue; label?: string }
>();

/** 去掉 class 后的分隔线属性，转交 Separator；label 与 orientation 只影响模板里的尺寸和居中文字，不下发给底层。 */
const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props;

  return delegated;
});
</script>

<template>
  <Separator
    v-bind="delegatedProps"
    :class="
      cn(
        'relative shrink-0 bg-border',
        props.orientation === 'vertical' ? 'h-full w-px' : 'h-px w-full',
        props.class,
      )
    "
  >
    <span
      v-if="props.label"
      :class="
        cn(
          'absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-background text-xs text-muted-foreground',
          props.orientation === 'vertical'
            ? 'w-[1px] px-1 py-2'
            : 'h-[1px] px-2 py-1',
        )
      "
    >
      {{ props.label }}
    </span>
  </Separator>
</template>

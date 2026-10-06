<script setup lang="ts">
/**
 * 数字输入框文本域：套用居中、边框与聚焦环等基础样式。
 * 不接受 class 覆盖；data-slot 标记供内容容器定位增减按钮。
 */
import { cn } from '@vben-core/shared/utils';

import { NumberFieldInput } from 'reka-ui';
</script>

<template>
  <NumberFieldInput
    :class="
      cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent py-1 text-center text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      )
    "
    data-slot="input"
  />
</template>

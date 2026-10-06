<script lang="ts" setup>
/**
 * 统计卡片：展示单指标数值、提示气泡与环比涨跌，数值用滚动动画从旧值过渡。
 * 涨跌只按 percent 正负决定颜色与箭头方向，取值与文案由使用方经 props 传入。
 * 纯展示组件，不含请求、下钻与点击交互。
 */
import type { StatisticCardProps } from './types';

import {
  Card,
  CardContent,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  VbenCountToAnimator,
  VbenIcon,
} from '@vben-core/shadcn-ui';

/** 统计卡片 */
defineOptions({ name: 'StatisticCard' });

withDefaults(defineProps<StatisticCardProps>(), {
  percentLabel: '环比',
});
</script>

<template>
  <Card class="h-full">
    <CardContent class="flex flex-col gap-2 p-6">
      <div class="text-muted-foreground flex items-center justify-between">
        <span class="text-sm">{{ title }}</span>
        <TooltipProvider v-if="tooltip">
          <Tooltip>
            <TooltipTrigger>
              <VbenIcon
                icon="lucide:circle-alert"
                class="text-muted-foreground size-4 cursor-help"
              />
            </TooltipTrigger>
            <TooltipContent>
              <p>{{ tooltip }}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div class="mb-4 text-3xl font-medium">
        <VbenCountToAnimator
          :prefix="prefix"
          :end-val="value ?? 0"
          :decimals="decimals ?? 0"
        />
      </div>
      <div class="flex flex-row gap-1 text-sm">
        <span class="text-muted-foreground">{{ percentLabel }}</span>
        <span
          :class="
            Number(percent) > 0
              ? 'text-destructive'
              : 'text-emerald-600 dark:text-emerald-400'
          "
          class="flex items-center gap-0.5"
        >
          {{ Math.abs(Number(percent ?? 0)).toFixed(2) }}%
          <VbenIcon
            :icon="
              Number(percent) > 0
                ? 'lucide:trending-up'
                : 'lucide:trending-down'
            "
            class="size-3"
          />
        </span>
      </div>
    </CardContent>
  </Card>
</template>

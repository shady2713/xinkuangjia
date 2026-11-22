<script setup lang="ts">
/**
 * 通用统计指标卡片（StatCard）：
 * 供概览页及所有后续业务统计页面统一复用，遵循 Vben 5 浅色卡片视觉规范。
 */
import type { Component } from 'vue';

export type StatTone = 'primary' | 'success' | 'warning' | 'info';

withDefaults(
  defineProps<{
    title: string;
    value: number | string;
    unit?: string;
    subtitle?: string;
    footerLabel?: string;
    footerValue?: number | string;
    icon?: Component;
    tone?: StatTone;
    loading?: boolean;
  }>(),
  {
    unit: '',
    subtitle: '',
    footerLabel: '',
    footerValue: '',
    icon: undefined,
    tone: 'primary',
    loading: false,
  },
);

const TONE_CLASSES: Record<StatTone, string> = {
  primary: 'bg-[#e6f0fc] text-[#006be6]',
  success: 'bg-[#ecfdf5] text-[#10b981]',
  warning: 'bg-[#fffbeb] text-[#f59e0b]',
  info: 'bg-[#f1f5f9] text-[#475569]',
};
</script>

<template>
  <el-card
    shadow="never"
    class="h-full transition-colors hover:border-[#cbd5e1]"
    :body-style="{ padding: '18px 20px' }"
  >
    <el-skeleton :loading="loading" animated :rows="2">
      <template #default>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="truncate text-[13px] font-medium text-[#64748b]">
              {{ title }}
            </div>
            <div class="mt-2 flex items-baseline gap-1.5">
              <span class="text-[28px] font-bold leading-none tracking-tight text-[#18181b] tabular-nums">
                {{ value }}
              </span>
              <span v-if="unit" class="text-xs font-medium text-[#64748b]">
                {{ unit }}
              </span>
            </div>
            <div v-if="subtitle" class="mt-1.5 truncate text-xs text-[#94a3b8]">
              {{ subtitle }}
            </div>
          </div>

          <div
            v-if="icon"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            :class="TONE_CLASSES[tone]"
          >
            <el-icon :size="20">
              <component :is="icon" />
            </el-icon>
          </div>
        </div>

        <div
          v-if="footerLabel || $slots.footer"
          class="mt-4 flex items-center justify-between border-t border-[#f1f2f5] pt-3 text-xs"
        >
          <slot name="footer">
            <span class="text-[#64748b]">{{ footerLabel }}</span>
            <span class="font-medium text-[#334155] tabular-nums">{{ footerValue }}</span>
          </slot>
        </div>
      </template>
    </el-skeleton>
  </el-card>
</template>

<script setup lang="ts">
/**
 * 通用统计图表卡片容器（ChartCard）：
 * 统一标题、副标题、筛选区插槽、加载态与空状态，供各业务统计模块直接引用。
 */
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    loading?: boolean;
    empty?: boolean;
    emptyText?: string;
  }>(),
  {
    subtitle: '',
    loading: false,
    empty: false,
    emptyText: '暂无统计数据',
  },
);
</script>

<template>
  <el-card shadow="never" class="h-full" :body-style="{ padding: '16px 20px' }">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[15px] font-semibold text-[#18181b]">{{ title }}</div>
          <div v-if="subtitle" class="mt-0.5 text-xs text-[#64748b]">{{ subtitle }}</div>
        </div>
        <div v-if="$slots.extra" class="flex items-center gap-2">
          <slot name="extra" />
        </div>
      </div>
    </template>

    <div v-loading="loading" class="min-h-[260px]">
      <el-empty v-if="!loading && empty" :image-size="72" :description="emptyText" />
      <slot v-else />
    </div>
  </el-card>
</template>

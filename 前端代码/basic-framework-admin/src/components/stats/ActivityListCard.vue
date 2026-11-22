<script setup lang="ts">
/**
 * 通用统计动态/排行列表卡片（ActivityListCard）：
 * 供概览页最近动态及业务统计排行复用。
 */
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    loading?: boolean;
    empty?: boolean;
    emptyText?: string;
    moreText?: string;
  }>(),
  {
    subtitle: '',
    loading: false,
    empty: false,
    emptyText: '暂无记录',
    moreText: '',
  },
);

const emit = defineEmits<{
  (e: 'more'): void;
}>();
</script>

<template>
  <el-card shadow="never" class="h-full" :body-style="{ padding: '12px 20px 16px' }">
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-[15px] font-semibold text-[#18181b]">{{ title }}</div>
          <div v-if="subtitle" class="mt-0.5 text-xs text-[#64748b]">{{ subtitle }}</div>
        </div>
        <el-button
          v-if="moreText"
          link
          type="primary"
          size="small"
          @click="emit('more')"
        >
          {{ moreText }}
        </el-button>
      </div>
    </template>

    <div v-loading="loading" class="min-h-[210px]">
      <el-empty v-if="!loading && empty" :image-size="60" :description="emptyText" />
      <slot v-else />
    </div>
  </el-card>
</template>

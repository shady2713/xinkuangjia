<script setup lang="ts">
/**
 * 极简标准表格容器（替代 700KB vxe-table）：
 * 统一承载搜索表单卡片、白底列表卡片、工具栏（左侧操作区 + 右侧刷新/密度）与底部分页。
 */
import { Refresh } from '@element-plus/icons-vue';

withDefaults(
  defineProps<{
    title?: string;
    loading?: boolean;
    total?: number;
    pageNo?: number;
    pageSize?: number;
    showPagination?: boolean;
  }>(),
  {
    title: '',
    loading: false,
    total: 0,
    pageNo: 1,
    pageSize: 10,
    showPagination: true,
  },
);

const emit = defineEmits<{
  (e: 'update:pageNo', val: number): void;
  (e: 'update:pageSize', val: number): void;
  (e: 'refresh'): void;
}>();

function handleCurrentChange(val: number) {
  emit('update:pageNo', val);
  emit('refresh');
}

function handleSizeChange(val: number) {
  emit('update:pageSize', val);
  emit('update:pageNo', 1);
  emit('refresh');
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <el-card
      v-if="$slots.search"
      shadow="never"
      class="bf-search-card"
      :body-style="{ padding: '16px 16px 0 16px' }"
    >
      <slot name="search" />
    </el-card>

    <el-card
      shadow="never"
      class="bf-table-card"
      :body-style="{ padding: '16px' }"
    >
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span
            v-if="title"
            class="mr-2 text-[15px] font-semibold text-[#1f2937]"
          >
            {{ title }}
          </span>
          <slot name="toolbar" />
        </div>
        <div class="flex items-center gap-2">
          <slot name="toolbar-right" />
          <el-tooltip content="刷新列表" placement="top">
            <el-button
              :icon="Refresh"
              circle
              size="small"
              :loading="loading"
              @click="emit('refresh')"
            />
          </el-tooltip>
        </div>
      </div>

      <div v-loading="loading">
        <slot />
      </div>

      <div v-if="showPagination" class="mt-4 flex justify-end">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="pageNo"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          @current-change="handleCurrentChange"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>
  </div>
</template>

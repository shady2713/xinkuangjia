<script setup lang="ts">
/**
 * 1:1 复刻原 Vben 5 列表页容器规范：
 * - 上方搜索卡片（支持通过工具栏图标一键显隐）
 * - 下方白底列表卡片：左标题 + 右侧操作按钮组（新增/导出/导入/批量删除）+ 搜索切换/密度切换/刷新工具图标
 * - 底部统一右侧分页条
 */
import { Operation, Refresh, Search } from '@element-plus/icons-vue';
import { ref } from 'vue';

export type TableDensity = 'small' | 'default' | 'large';

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

const searchVisible = ref(true);
const tableSize = ref<TableDensity>('default');

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
      v-if="$slots.search && searchVisible"
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
        <div class="flex items-center gap-2">
          <span
            v-if="title"
            class="text-[15px] font-semibold text-[#1f2937]"
          >
            {{ title }}
          </span>
          <slot name="toolbar-left" />
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <slot name="toolbar" />
          <slot name="toolbar-right" />

          <el-divider
            v-if="$slots.toolbar || $slots['toolbar-right']"
            direction="vertical"
            class="!mx-1"
          />

          <el-tooltip
            v-if="$slots.search"
            :content="searchVisible ? '隐藏搜索栏' : '显示搜索栏'"
            placement="top"
          >
            <el-button
              :icon="Search"
              circle
              size="small"
              :type="searchVisible ? 'primary' : 'default'"
              plain
              @click="searchVisible = !searchVisible"
            />
          </el-tooltip>

          <el-dropdown trigger="click" @command="(cmd: TableDensity) => (tableSize = cmd)">
            <span class="inline-flex">
              <el-tooltip content="表格密度" placement="top">
                <el-button :icon="Operation" circle size="small" />
              </el-tooltip>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  command="large"
                  :class="{ '!font-semibold !text-[#006be6]': tableSize === 'large' }"
                >
                  宽松
                </el-dropdown-item>
                <el-dropdown-item
                  command="default"
                  :class="{ '!font-semibold !text-[#006be6]': tableSize === 'default' }"
                >
                  默认
                </el-dropdown-item>
                <el-dropdown-item
                  command="small"
                  :class="{ '!font-semibold !text-[#006be6]': tableSize === 'small' }"
                >
                  紧凑
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

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
        <slot :size="tableSize" />
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

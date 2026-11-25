<script setup lang="ts">
/**
 * 1:1 复刻原 Vben 5 VxeGrid 列表页唯一容器（最小化封装，全站 10 个 CRUD 视图单点统一）：
 * - 默认 autoHeight=true：一屏锁高，搜索区与分页条始终锚定可视区，仅表格数据体内部滚动
 * - 搜索区自动套用 Vben 5 响应式 Grid 网格排版，支持平滑显隐切换
 * - 右侧 Lucide 工具区：搜索显隐、表格密度、列显隐设置（含重置）、表格全屏放大、刷新列表
 */
import {
  Columns3,
  Maximize2,
  Minimize2,
  RotateCw,
  Search,
  SlidersHorizontal,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export type TableDensity = 'small' | 'default' | 'large';

export interface ProTableColumnOption {
  key: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    title?: string;
    loading?: boolean;
    total?: number;
    pageNo?: number;
    pageSize?: number;
    showPagination?: boolean;
    autoHeight?: boolean;
    columns?: ProTableColumnOption[];
  }>(),
  {
    title: '',
    loading: false,
    total: 0,
    pageNo: 1,
    pageSize: 10,
    showPagination: true,
    autoHeight: true,
    columns: () => [],
  },
);

const emit = defineEmits<{
  (e: 'update:pageNo', val: number): void;
  (e: 'update:pageSize', val: number): void;
  (e: 'refresh'): void;
}>();

const searchVisible = ref(true);
const tableFullscreen = ref(false);
const tableSize = ref<TableDensity>('default');
const hiddenColumns = ref<Set<string>>(new Set());
const tableWrapRef = ref<HTMLDivElement | null>(null);
const measuredHeight = ref<number | undefined>(undefined);
let resizeObserver: ResizeObserver | null = null;

const effectiveHeight = computed(() => {
  if (!props.autoHeight && !tableFullscreen.value) return undefined;
  return measuredHeight.value && measuredHeight.value >= 180 ? measuredHeight.value : undefined;
});

function isColVisible(key: string): boolean {
  return !hiddenColumns.value.has(key);
}

function toggleColumn(key: string, visible: boolean) {
  const next = new Set(hiddenColumns.value);
  if (visible) {
    next.delete(key);
  } else {
    next.add(key);
  }
  hiddenColumns.value = next;
}

function resetColumns() {
  hiddenColumns.value = new Set();
}

function handleCurrentChange(val: number) {
  emit('update:pageNo', val);
  emit('refresh');
}

function handleSizeChange(val: number) {
  emit('update:pageSize', val);
  emit('update:pageNo', 1);
  emit('refresh');
}

function syncTableHeight() {
  const el = tableWrapRef.value;
  if (!el) return;
  const h = Math.floor(el.clientHeight);
  if (h >= 180) {
    measuredHeight.value = h;
  }
}

onMounted(() => {
  syncTableHeight();
  if (typeof ResizeObserver !== 'undefined' && tableWrapRef.value) {
    resizeObserver = new ResizeObserver(() => {
      syncTableHeight();
    });
    resizeObserver.observe(tableWrapRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <div
    class="bf-pro-table flex flex-col gap-3"
    :class="[
      tableFullscreen
        ? 'fixed inset-0 z-[2000] h-screen bg-[var(--bf-bg-deep)] p-4'
        : autoHeight
          ? 'h-full min-h-0'
          : '',
    ]"
  >
    <transition name="bf-search-collapse">
      <el-card
        v-if="$slots.search && searchVisible"
        shadow="never"
        class="bf-search-card shrink-0"
        :body-style="{ padding: '16px 16px 4px 16px' }"
      >
        <slot name="search" />
      </el-card>
    </transition>

    <el-card
      shadow="never"
      class="bf-table-card flex min-h-0 flex-1 flex-col"
      :body-style="{
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 0%',
        minHeight: '0',
      }"
    >
      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span
            v-if="title"
            class="text-[15px] font-semibold text-[#18181b]"
          >
            {{ title }}
          </span>
          <slot name="toolbar-left" />
        </div>

        <div class="bf-pro-toolbar flex flex-wrap items-center gap-2">
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
            <button
              type="button"
              class="bf-tool-icon-btn"
              :class="{ 'is-active': searchVisible }"
              @click="searchVisible = !searchVisible"
            >
              <Search class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
          </el-tooltip>

          <el-dropdown trigger="click" @command="(cmd: TableDensity) => (tableSize = cmd)">
            <span class="inline-flex">
              <el-tooltip content="表格密度" placement="top">
                <button type="button" class="bf-tool-icon-btn">
                  <SlidersHorizontal class="h-3.5 w-3.5" :stroke-width="1.75" />
                </button>
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

          <!-- 列显隐设置（对齐原版 Vben 5 VxeGrid custom 列配置） -->
          <el-popover
            v-if="columns.length > 0"
            trigger="click"
            placement="bottom-end"
            :width="210"
          >
            <template #reference>
              <span class="inline-flex">
                <el-tooltip content="列显示设置" placement="top">
                  <button
                    type="button"
                    class="bf-tool-icon-btn"
                    :class="{ 'is-active': hiddenColumns.size > 0 }"
                  >
                    <Columns3 class="h-3.5 w-3.5" :stroke-width="1.75" />
                  </button>
                </el-tooltip>
              </span>
            </template>
            <div>
              <div class="mb-2 flex items-center justify-between border-b border-[#f1f2f5] pb-2">
                <span class="text-xs font-semibold text-[#18181b]">列展示</span>
                <button
                  type="button"
                  class="cursor-pointer text-xs text-[#006be6] hover:underline"
                  @click="resetColumns"
                >
                  重置
                </button>
              </div>
              <div class="flex max-h-[240px] flex-col gap-1 overflow-y-auto">
                <el-checkbox
                  v-for="col in columns"
                  :key="col.key"
                  :model-value="isColVisible(col.key)"
                  @update:model-value="(val: string | number | boolean) => toggleColumn(col.key, Boolean(val))"
                >
                  <span class="text-xs text-[#334155]">{{ col.label }}</span>
                </el-checkbox>
              </div>
            </div>
          </el-popover>

          <el-tooltip :content="tableFullscreen ? '还原表格' : '表格全屏'" placement="top">
            <button
              type="button"
              class="bf-tool-icon-btn"
              :class="{ 'is-active': tableFullscreen }"
              @click="tableFullscreen = !tableFullscreen"
            >
              <Minimize2 v-if="tableFullscreen" class="h-3.5 w-3.5" :stroke-width="1.75" />
              <Maximize2 v-else class="h-3.5 w-3.5" :stroke-width="1.75" />
            </button>
          </el-tooltip>

          <el-tooltip content="刷新列表" placement="top">
            <button
              type="button"
              class="bf-tool-icon-btn"
              @click="emit('refresh')"
            >
              <RotateCw
                class="h-3.5 w-3.5"
                :class="{ 'animate-spin': loading }"
                :stroke-width="1.75"
              />
            </button>
          </el-tooltip>
        </div>
      </div>

      <div ref="tableWrapRef" v-loading="loading" class="bf-pro-table-wrap min-h-[220px] flex-1 overflow-hidden">
        <slot :size="tableSize" :table-height="effectiveHeight" :is-col-visible="isColVisible" />
      </div>

      <div v-if="showPagination" class="mt-3 flex shrink-0 justify-end">
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

<style scoped>
.bf-tool-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9999px;
  border: 1px solid #e4e4e7;
  background-color: #ffffff;
  color: #52525b;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease,
    transform 0.1s ease;
}

.bf-tool-icon-btn:hover {
  background-color: #f4f4f5;
  color: #18181b;
  border-color: #d4d4d8;
}

.bf-tool-icon-btn:active {
  transform: scale(0.95);
}

.bf-tool-icon-btn.is-active {
  background-color: #e6f0fc;
  border-color: #b3d3f7;
  color: #006be6;
}

/* 统一收口全站 10 个列表页的搜索栏为 Vben 5 规整响应式 Grid 布局，无需修改各页面逐行布局 */
.bf-search-card :deep(.el-form.el-form--inline) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 0 16px;
  align-items: center;
}

.bf-search-card :deep(.el-form.el-form--inline .el-form-item) {
  display: flex;
  margin-right: 0;
  margin-bottom: 12px;
  width: 100%;
}

.bf-search-card :deep(.el-form.el-form--inline .el-form-item__content) {
  flex: 1 1 0%;
  min-width: 0;
}

.bf-search-card :deep(.el-form.el-form--inline .el-input),
.bf-search-card :deep(.el-form.el-form--inline .el-select),
.bf-search-card :deep(.el-form.el-form--inline .el-date-editor) {
  width: 100% !important;
}

.bf-search-card :deep(.el-form.el-form--inline .el-form-item:last-child) {
  grid-column: -2 / -1;
  justify-self: end;
  width: auto;
}

.bf-search-card :deep(.el-form.el-form--inline .el-form-item:last-child .el-form-item__content) {
  flex: 0 0 auto;
  justify-content: flex-end;
}

/* 弱化数据行内部竖线，对齐原版 Vben 5 VxeGrid 轻量视觉 */
.bf-pro-table-wrap :deep(.el-table--border td.el-table__cell) {
  border-right-color: transparent;
}

.bf-pro-table-wrap :deep(.el-table--border th.el-table__cell) {
  border-right-color: #eef0f4;
}
</style>

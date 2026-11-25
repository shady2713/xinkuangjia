<script setup lang="ts">
/**
 * 1:1 复刻原 Vben Admin 5 Chrome 风格多标签页栏（tabs-chrome）：
 * - 全套 Lucide 细线条图标（X / Pin / ChevronDown / RotateCw / Maximize2 / Minimize2）
 * - TransitionGroup(slide-left) 滑入/滑出/位移动画 + 图标悬浮微缩动画(shrink)
 * - 激活标签采用 primary/15 圆角弧翼造型，悬停时自动淡出相邻分隔线
 * - 支持鼠标滚轮横向滚动、非固定标签拖拽排序、固定/取消固定、中键关闭与右键上下文菜单
 */
import {
  ChevronDown,
  Maximize2,
  Minimize2,
  Pin,
  RotateCw,
  X,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import MenuIcon from '@/components/MenuIcon.vue';
import type { TabItem } from '@/stores/tabs';

const props = defineProps<{
  tabs: TabItem[];
  activePath: string;
  contentMaximized: boolean;
  refreshing?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', path: string): void;
  (e: 'close', path: string): void;
  (e: 'toggle-pin', path: string): void;
  (e: 'reorder', fromIndex: number, toIndex: number): void;
  (e: 'close-left', path: string): void;
  (e: 'close-right', path: string): void;
  (e: 'close-other', path: string): void;
  (e: 'close-all'): void;
  (e: 'refresh'): void;
  (e: 'toggle-maximize'): void;
}>();

const scrollContainerRef = ref<HTMLDivElement | null>(null);
const draggingIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  targetPath: '',
});

const contextTab = computed(() =>
  props.tabs.find((t) => t.path === contextMenu.targetPath),
);
const contextTabIndex = computed(() =>
  props.tabs.findIndex((t) => t.path === contextMenu.targetPath),
);

function handleWheel(event: WheelEvent) {
  const el = scrollContainerRef.value;
  if (!el || el.scrollWidth <= el.clientWidth) return;
  event.preventDefault();
  el.scrollLeft += event.deltaY || event.deltaX;
}

function onDragStart(event: DragEvent, index: number, tab: TabItem) {
  if (tab.affix) {
    event.preventDefault();
    return;
  }
  draggingIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

function onDragOver(event: DragEvent, index: number, tab: TabItem) {
  if (draggingIndex.value === null || tab.affix) return;
  event.preventDefault();
  dragOverIndex.value = index;
}

function onDrop(event: DragEvent, index: number, tab: TabItem) {
  event.preventDefault();
  if (draggingIndex.value !== null && !tab.affix && draggingIndex.value !== index) {
    emit('reorder', draggingIndex.value, index);
  }
  draggingIndex.value = null;
  dragOverIndex.value = null;
}

function onDragEnd() {
  draggingIndex.value = null;
  dragOverIndex.value = null;
}

function openContextMenu(event: MouseEvent, tab: TabItem) {
  event.preventDefault();
  contextMenu.targetPath = tab.path;
  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.visible = true;
}

function hideContextMenu() {
  contextMenu.visible = false;
}

function handleContextAction(action: string) {
  const path = contextMenu.targetPath;
  hideContextMenu();
  if (!path) return;
  if (action === 'refresh') {
    if (path !== props.activePath) emit('select', path);
    emit('refresh');
  } else if (action === 'toggle-pin') {
    emit('toggle-pin', path);
  } else if (action === 'close') {
    emit('close', path);
  } else if (action === 'close-left') {
    emit('close-left', path);
  } else if (action === 'close-right') {
    emit('close-right', path);
  } else if (action === 'close-other') {
    emit('close-other', path);
  } else if (action === 'close-all') {
    emit('close-all');
  }
}

function handleMoreCommand(cmd: string) {
  if (cmd === 'refresh') emit('refresh');
  else if (cmd === 'close-current') emit('close', props.activePath);
  else if (cmd === 'close-left') emit('close-left', props.activePath);
  else if (cmd === 'close-right') emit('close-right', props.activePath);
  else if (cmd === 'close-other') emit('close-other', props.activePath);
  else if (cmd === 'close-all') emit('close-all');
}

function handleMiddleClick(event: MouseEvent, tab: TabItem) {
  if (event.button === 1 && !tab.affix && props.tabs.length > 1) {
    event.preventDefault();
    emit('close', tab.path);
  }
}

onMounted(() => {
  window.addEventListener('click', hideContextMenu);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', hideContextMenu);
});
</script>

<template>
  <div
    class="flex h-[38px] shrink-0 items-end justify-between border-b border-[#e4e4e7] bg-white pl-2"
  >
    <div
      ref="scrollContainerRef"
      class="bf-tabs-scroll flex h-full min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden pt-[3px]"
      @wheel="handleWheel"
    >
      <TransitionGroup
        name="slide-left"
        tag="div"
        class="bf-tabs-chrome flex h-full w-max items-end pr-6"
      >
        <div
          v-for="(tab, index) in tabs"
          :key="tab.path"
          :draggable="!tab.affix"
          class="bf-tab-item group relative -mr-2.5 flex h-[34px] cursor-pointer select-none items-center"
          :class="{
            'is-active z-[2]': tab.path === activePath,
            'opacity-50': draggingIndex === index,
            'bf-tab-drag-over': dragOverIndex === index && draggingIndex !== index,
          }"
          @click="emit('select', tab.path)"
          @mousedown="handleMiddleClick($event, tab)"
          @contextmenu="openContextMenu($event, tab)"
          @dragstart="onDragStart($event, index, tab)"
          @dragover="onDragOver($event, index, tab)"
          @drop="onDrop($event, index, tab)"
          @dragend="onDragEnd"
        >
          <!-- 左侧分隔线 -->
          <div
            v-if="index !== 0"
            class="bf-tab-divider absolute left-[7px] top-1/2 z-0 h-4 w-[1px] -translate-y-1/2 bg-[#e4e4e7] transition-opacity duration-150"
          />

          <!-- Chrome 曲线底背与两侧弧翼 -->
          <div class="bf-tab-bg pointer-events-none absolute inset-0 px-[6px]">
            <div
              class="bf-tab-bg-main h-full rounded-t-[7px] transition-all duration-150"
            />
            <svg
              class="bf-tab-wing-left absolute bottom-0 left-0 h-[7px] w-[7px] transition-colors duration-150"
              viewBox="0 0 7 7"
            >
              <path d="M 0 7 A 7 7 0 0 0 7 0 L 7 7 Z" />
            </svg>
            <svg
              class="bf-tab-wing-right absolute bottom-0 right-0 h-[7px] w-[7px] transition-colors duration-150"
              viewBox="0 0 7 7"
            >
              <path d="M 0 0 A 7 7 0 0 0 7 7 L 0 7 Z" />
            </svg>
          </div>

          <!-- 内容区 -->
          <div
            class="relative z-[1] flex items-center gap-1.5 pl-4 text-[13px] transition-colors duration-150"
            :class="[
              tab.path === activePath
                ? 'font-medium text-[#006be6]'
                : 'text-[#52525b] group-hover:text-[#18181b]',
              (!tab.affix && tabs.length > 1) || (tab.affix && !tab.permanentAffix) ? 'pr-7' : 'pr-4',
            ]"
          >
            <MenuIcon
              v-if="tab.icon"
              :name="tab.icon"
              class="bf-tab-icon shrink-0 !text-[14px]"
            />
            <span class="max-w-[140px] truncate">{{ tab.title }}</span>
          </div>

          <!-- 关闭按钮 / 取消固定按钮 -->
          <button
            v-if="!tab.affix && tabs.length > 1"
            type="button"
            class="absolute right-[10px] top-1/2 z-[2] flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[#71717a] transition hover:bg-[#e4e4e7] hover:text-[#18181b]"
            title="关闭标签页"
            @click.stop="emit('close', tab.path)"
          >
            <X class="h-3 w-3" :stroke-width="2" />
          </button>
          <button
            v-else-if="tab.affix && !tab.permanentAffix"
            type="button"
            class="absolute right-[10px] top-1/2 z-[2] flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[#71717a] transition hover:bg-[#e4e4e7] hover:text-[#006be6]"
            title="取消固定标签页"
            @click.stop="emit('toggle-pin', tab.path)"
          >
            <Pin class="h-3 w-3" :stroke-width="2" />
          </button>
        </div>
      </TransitionGroup>
    </div>

    <!-- 右侧工具栏（对齐 Vben 5：更多、刷新、最大化） -->
    <div class="flex h-full shrink-0 items-center border-l border-[#e4e4e7] bg-white">
      <el-dropdown trigger="click" @command="handleMoreCommand">
        <button
          type="button"
          class="flex h-full w-9 cursor-pointer items-center justify-center border-r border-[#f1f2f5] text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#1f2937]"
          title="标签页操作"
        >
          <ChevronDown class="h-4 w-4" :stroke-width="1.75" />
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="refresh">重新加载</el-dropdown-item>
            <el-dropdown-item command="close-current" divided>关闭当前标签</el-dropdown-item>
            <el-dropdown-item command="close-left">关闭左侧标签</el-dropdown-item>
            <el-dropdown-item command="close-right">关闭右侧标签</el-dropdown-item>
            <el-dropdown-item command="close-other">关闭其他标签</el-dropdown-item>
            <el-dropdown-item command="close-all">关闭全部标签</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <button
        type="button"
        class="flex h-full w-9 cursor-pointer items-center justify-center border-r border-[#f1f2f5] text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#1f2937]"
        title="重新加载"
        @click="emit('refresh')"
      >
        <RotateCw
          class="h-3.5 w-3.5"
          :class="{ 'animate-spin': refreshing }"
          :stroke-width="1.75"
        />
      </button>

      <button
        type="button"
        class="flex h-full w-9 cursor-pointer items-center justify-center text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#1f2937]"
        :class="{ '!bg-[#e6f0fc] !text-[#006be6]': contentMaximized }"
        :title="contentMaximized ? '退出内容区最大化' : '最大化内容区'"
        @click="emit('toggle-maximize')"
      >
        <Minimize2 v-if="contentMaximized" class="h-3.5 w-3.5" :stroke-width="1.75" />
        <Maximize2 v-else class="h-3.5 w-3.5" :stroke-width="1.75" />
      </button>
    </div>

    <!-- 右键上下文菜单 -->
    <Teleport to="body">
      <transition name="fade">
        <div
          v-if="contextMenu.visible"
          class="fixed z-[3000] min-w-[152px] rounded-lg border border-[#e4e4e7] bg-white py-1 shadow-md"
          :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
          @click.stop
        >
          <button
            type="button"
            class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f4f4f5]"
            @click="handleContextAction('refresh')"
          >
            重新加载
          </button>
          <button
            v-if="contextTab && !contextTab.permanentAffix"
            type="button"
            class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f4f4f5]"
            @click="handleContextAction('toggle-pin')"
          >
            {{ contextTab.affix ? '取消固定' : '固定标签页' }}
          </button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="contextTab?.affix || tabs.length <= 1"
            @click="handleContextAction('close')"
          >
            关闭标签页
          </button>
          <div class="my-1 h-[1px] bg-[#f1f2f5]" />
          <button
            type="button"
            class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="contextTabIndex <= 1"
            @click="handleContextAction('close-left')"
          >
            关闭左侧标签
          </button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="contextTabIndex >= tabs.length - 1"
            @click="handleContextAction('close-right')"
          >
            关闭右侧标签
          </button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f4f4f5]"
            @click="handleContextAction('close-other')"
          >
            关闭其他标签
          </button>
          <button
            type="button"
            class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] transition-colors hover:bg-[#f4f4f5]"
            @click="handleContextAction('close-all')"
          >
            关闭全部标签
          </button>
        </div>
      </transition>
    </Teleport>
  </div>
</template>

<style scoped>
.bf-tabs-scroll {
  scrollbar-width: none;
}

.bf-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.bf-tab-bg-main {
  background-color: transparent;
}

.bf-tab-wing-left,
.bf-tab-wing-right {
  fill: transparent;
}

.bf-tab-item:hover .bf-tab-icon {
  animation: shrink 0.3s ease-in-out;
}

.bf-tab-item.is-active .bf-tab-divider,
.bf-tab-item.is-active + .bf-tab-item .bf-tab-divider,
.bf-tab-item:hover:not(.is-active) .bf-tab-divider,
.bf-tab-item:hover:not(.is-active) + .bf-tab-item .bf-tab-divider {
  opacity: 0;
}

.bf-tab-item:not(.is-active):hover .bf-tab-bg-main {
  background-color: var(--bf-accent);
  border-radius: 7px;
  height: 28px;
  margin-top: 3px;
}

.bf-tab-item.is-active .bf-tab-bg-main {
  background-color: var(--bf-primary-tab);
}

.bf-tab-item.is-active .bf-tab-wing-left,
.bf-tab-item.is-active .bf-tab-wing-right {
  fill: var(--bf-primary-tab);
}

.bf-tab-drag-over .bf-tab-bg-main {
  box-shadow: inset 2px 0 0 0 var(--bf-primary);
}
</style>

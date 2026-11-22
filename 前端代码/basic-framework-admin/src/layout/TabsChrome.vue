<script setup lang="ts">
/**
 * 1:1 复刻原 Vben Admin 5 Chrome 风格多标签页栏（tabs-chrome）：
 * - 激活标签采用 primary/14 圆角弧翼造型，非激活标签带竖向细分隔线
 * - 支持标签图标、悬浮关闭、中键关闭、右键上下文菜单（刷新/关闭/关闭左侧/关闭右侧/关闭其他/关闭全部）
 * - 右侧固定工具区：更多下拉、刷新当前页、内容区最大化切换
 */
import {
  ArrowDown,
  Close,
  FullScreen,
  Refresh,
} from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue';

import MenuIcon from '@/components/MenuIcon.vue';
import type { TabItem } from '@/stores/tabs';

const props = defineProps<{
  tabs: TabItem[];
  activePath: string;
  contentMaximized: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', path: string): void;
  (e: 'close', path: string): void;
  (e: 'close-left', path: string): void;
  (e: 'close-right', path: string): void;
  (e: 'close-other', path: string): void;
  (e: 'close-all'): void;
  (e: 'refresh'): void;
  (e: 'toggle-maximize'): void;
}>();

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
    <div class="flex h-full min-w-0 flex-1 items-end overflow-x-auto pt-[3px]">
      <div class="bf-tabs-chrome flex h-full w-max items-end pr-4">
        <div
          v-for="(tab, index) in tabs"
          :key="tab.path"
          class="bf-tab-item group relative -mr-2.5 flex h-[34px] cursor-pointer select-none items-center"
          :class="{ 'is-active z-[2]': tab.path === activePath }"
          @click="emit('select', tab.path)"
          @mousedown="handleMiddleClick($event, tab)"
          @contextmenu="openContextMenu($event, tab)"
        >
          <!-- 左侧分隔线 -->
          <div
            v-if="index !== 0 && tab.path !== activePath && tabs[index - 1]?.path !== activePath"
            class="absolute left-[7px] top-1/2 h-3.5 w-[1px] -translate-y-1/2 bg-[#e4e4e7] transition-opacity group-hover:opacity-0"
          />

          <!-- Chrome 曲线底背与两侧弧翼 -->
          <div class="bf-tab-bg pointer-events-none absolute inset-0 px-[6px]">
            <div
              class="bf-tab-bg-main h-full rounded-t-[7px] transition-colors duration-150"
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
            class="relative z-[1] flex items-center gap-1.5 pl-4 pr-3 text-[13px]"
            :class="[
              tab.path === activePath
                ? 'font-medium text-[#006be6]'
                : 'text-[#52525b] group-hover:text-[#18181b]',
              !tab.affix && tabs.length > 1 ? 'pr-7' : 'pr-4',
            ]"
          >
            <MenuIcon v-if="tab.icon" :name="tab.icon" class="shrink-0 !text-[14px]" />
            <span class="max-w-[140px] truncate">{{ tab.title }}</span>
          </div>

          <!-- 关闭按钮 -->
          <button
            v-if="!tab.affix && tabs.length > 1"
            type="button"
            class="absolute right-[10px] top-1/2 z-[2] flex h-4 w-4 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[#71717a] transition hover:bg-[#e4e4e7] hover:text-[#18181b]"
            title="关闭标签页"
            @click.stop="emit('close', tab.path)"
          >
            <el-icon :size="11"><Close /></el-icon>
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧工具栏（对齐 Vben 5：更多、刷新、最大化） -->
    <div class="flex h-full shrink-0 items-center border-l border-[#e4e4e7] bg-white">
      <el-dropdown trigger="click" @command="handleMoreCommand">
        <button
          type="button"
          class="flex h-full w-9 cursor-pointer items-center justify-center border-r border-[#f1f2f5] text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#1f2937]"
          title="标签页操作"
        >
          <el-icon :size="14"><ArrowDown /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="refresh">刷新当前页</el-dropdown-item>
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
        title="刷新当前页"
        @click="emit('refresh')"
      >
        <el-icon :size="14"><Refresh /></el-icon>
      </button>

      <button
        type="button"
        class="flex h-full w-9 cursor-pointer items-center justify-center text-[#64748b] transition hover:bg-[#f4f4f5] hover:text-[#1f2937]"
        :class="{ '!bg-[#e6f0fc] !text-[#006be6]': contentMaximized }"
        :title="contentMaximized ? '退出内容区最大化' : '最大化内容区'"
        @click="emit('toggle-maximize')"
      >
        <el-icon :size="14"><FullScreen /></el-icon>
      </button>
    </div>

    <!-- 右键上下文菜单 -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="fixed z-[3000] min-w-[144px] rounded-lg border border-[#e4e4e7] bg-white py-1 shadow-lg"
        :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
        @click.stop
      >
        <button
          type="button"
          class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] hover:bg-[#f4f4f5]"
          @click="handleContextAction('refresh')"
        >
          重新加载
        </button>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="contextTab?.affix || tabs.length <= 1"
          @click="handleContextAction('close')"
        >
          关闭标签页
        </button>
        <div class="my-1 h-[1px] bg-[#f1f2f5]" />
        <button
          type="button"
          class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="contextTabIndex <= 1"
          @click="handleContextAction('close-left')"
        >
          关闭左侧标签
        </button>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] hover:bg-[#f4f4f5] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="contextTabIndex >= tabs.length - 1"
          @click="handleContextAction('close-right')"
        >
          关闭右侧标签
        </button>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] hover:bg-[#f4f4f5]"
          @click="handleContextAction('close-other')"
        >
          关闭其他标签
        </button>
        <button
          type="button"
          class="flex w-full cursor-pointer items-center px-3 py-1.5 text-left text-[13px] text-[#334155] hover:bg-[#f4f4f5]"
          @click="handleContextAction('close-all')"
        >
          关闭全部标签
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.bf-tab-bg-main {
  background-color: transparent;
}

.bf-tab-wing-left,
.bf-tab-wing-right {
  fill: transparent;
}

.bf-tab-item:not(.is-active):hover .bf-tab-bg-main {
  background-color: #f4f4f5;
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
</style>

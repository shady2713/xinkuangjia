<script setup lang="ts">
/**
 * 全局搜索入口：负责弹窗开关、系统搜索快捷键绑定与输入框聚焦。
 * 关闭时清空关键词，菜单数据原样下传；命中快捷键且开关打开才弹窗。
 * 菜单匹配与结果渲染全部交给 SearchPanel，本组件不查菜单。
 */
import type { MenuRecordRaw } from '@vben/types';

import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  ArrowDown,
  ArrowUp,
  CornerDownLeft,
  MdiKeyboardEsc,
  Search,
} from '@vben/icons';
import { $t } from '@vben/locales';
import { isWindowsOs } from '@vben/utils';

import { useVbenModal } from '@vben-core/popup-ui';

import { useMagicKeys, whenever } from '@vueuse/core';

import SearchPanel from './search-panel.vue';

defineOptions({
  name: 'GlobalSearch',
});

const props = withDefaults(
  defineProps<{ enableShortcutKey?: boolean; menus?: MenuRecordRaw[] }>(),
  {
    enableShortcutKey: true,
    /** 菜单数据的默认值：空数组，未传入时没有可搜索的菜单项。 */
    menus: () => [],
  },
);

const keyword = ref('');
const searchInputRef = ref<HTMLInputElement>();

const [Modal, modalApi] = useVbenModal({
  /** 取消（关闭）回调：直接收起搜索弹窗。 */
  onCancel() {
    modalApi.close();
  },
  /**
   * 弹窗显隐变化回调。
   * @param isOpen 弹窗是否已打开；为 false（已关闭）时清空关键词，避免下次打开残留上次输入。
   */
  onOpenChange(isOpen: boolean) {
    if (!isOpen) {
      keyword.value = '';
    }
  },
});

/** 弹窗当前是否打开；供快捷键命中与切换方法读取，本身只读。 */
const open = modalApi.useStore((state) => state.isOpen);

/** 关闭搜索弹窗并清空关键词。 */
function handleClose() {
  modalApi.close();
  keyword.value = '';
}

const keys = useMagicKeys();
// useMagicKeys 以 Proxy 惰性创建组合键，索引结果在类型上仍是可选的；
// 缺失时跳过注册即可，运行时该组合键始终由 useMagicKeys 提供
const cmd = isWindowsOs() ? keys['ctrl+k'] : keys['cmd+k'];
if (cmd) {
  whenever(
    cmd,
    /**
     * 快捷键命中后按开关决定是否打开全局搜索弹窗。
     */
    () => {
      if (props.enableShortcutKey) {
        modalApi.open();
      }
    },
  );
}

whenever(open, () => {
  nextTick(() => {
    searchInputRef.value?.focus();
  });
});

/** 拦截浏览器自带的 Ctrl/⌘+K 行为，避免与系统搜索快捷键冲突。 */
const preventDefaultBrowserSearchHotKey = (event: KeyboardEvent) => {
  if (event.key?.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
  }
};

/** 按快捷键开关挂载或卸载 keydown 拦截器；关闭时不注册监听。 */
const toggleKeydownListener = () => {
  if (props.enableShortcutKey) {
    window.addEventListener('keydown', preventDefaultBrowserSearchHotKey);
  } else {
    window.removeEventListener('keydown', preventDefaultBrowserSearchHotKey);
  }
};

/** 在打开与关闭之间切换搜索弹窗。 */
const toggleOpen = () => {
  open.value ? modalApi.close() : modalApi.open();
};

watch(() => props.enableShortcutKey, toggleKeydownListener);

onMounted(() => {
  toggleKeydownListener();

  onUnmounted(() => {
    window.removeEventListener('keydown', preventDefaultBrowserSearchHotKey);
  });
});
</script>

<template>
  <div>
    <Modal
      :fullscreen-button="false"
      class="w-[600px]"
      header-class="py-2 border-b"
    >
      <template #title>
        <div class="flex items-center">
          <Search class="text-muted-foreground mr-2 size-4" />
          <input
            ref="searchInputRef"
            v-model="keyword"
            :placeholder="$t('ui.widgets.search.searchNavigate')"
            class="ring-none placeholder:text-muted-foreground w-[80%] rounded-md border border-none bg-transparent p-2 pl-0 text-sm font-normal outline-none ring-0 ring-offset-transparent focus-visible:ring-transparent"
          />
        </div>
      </template>

      <SearchPanel :keyword="keyword" :menus="menus" @close="handleClose" />
      <template #footer>
        <div class="flex w-full justify-start text-xs">
          <div class="mr-2 flex items-center">
            <CornerDownLeft class="mr-1 size-3" />
            {{ $t('ui.widgets.search.select') }}
          </div>
          <div class="mr-2 flex items-center">
            <ArrowUp class="mr-1 size-3" />
            <ArrowDown class="mr-1 size-3" />
            {{ $t('ui.widgets.search.navigate') }}
          </div>
          <div class="flex items-center">
            <MdiKeyboardEsc class="mr-1 size-3" />
            {{ $t('ui.widgets.search.close') }}
          </div>
        </div>
      </template>
    </Modal>
    <div
      class="md:bg-accent group flex h-8 cursor-pointer items-center gap-3 rounded-2xl border-none bg-none px-2 py-0.5 outline-none"
      @click="toggleOpen()"
    >
      <Search
        class="text-muted-foreground group-hover:text-foreground size-4 group-hover:opacity-100"
      />
      <span
        class="text-muted-foreground group-hover:text-foreground hidden text-xs duration-300 md:block"
      >
        {{ $t('ui.widgets.search.title') }}
      </span>
      <span
        v-if="enableShortcutKey"
        class="bg-background border-foreground/60 text-muted-foreground group-hover:text-foreground relative hidden rounded-sm rounded-r-xl px-1.5 py-1 text-xs leading-none group-hover:opacity-100 md:block"
      >
        {{ isWindowsOs() ? 'Ctrl' : '⌘' }}
        <kbd>K</kbd>
      </span>
      <span v-else></span>
    </div>
  </div>
</template>

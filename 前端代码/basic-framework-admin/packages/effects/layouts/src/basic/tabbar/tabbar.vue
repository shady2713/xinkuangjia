<script lang="ts" setup>
/**
 * 布局标签栏：把标签数据与右键菜单接到标签内核，并组装刷新、更多、最大化工具。
 * 标签增删、固定与禁用态由 useTabbar 计算，偏好开关决定工具是否渲染；
 * 本组件不缓存页面，keepAlive 与内容渲染由内容区组件负责。
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { useContentMaximize, useTabs } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import { useTabbarStore } from '@vben/stores';

import {
  TabsToolMore,
  TabsToolRefresh,
  TabsToolScreen,
  TabsView,
} from '@vben-core/tabs-ui';

import { useTabbar } from './use-tabbar';

defineOptions({
  name: 'LayoutTabbar',
});

defineProps<{ showIcon?: boolean; theme?: string }>();

const route = useRoute();
const tabbarStore = useTabbarStore();
const { contentIsMaximize, toggleMaximize } = useContentMaximize();
const { refreshTab, unpinTab } = useTabs();

const {
  createContextMenus,
  currentActive,
  currentTabs,
  handleClick,
  handleClose,
} = useTabbar();

/** 更多菜单项：取当前标签的可用操作，并补齐菜单组件需要的 label 与 value 字段。 */
const menus = computed(() => {
  const tab = tabbarStore.getTabByKey(currentActive.value);
  const menus = createContextMenus(tab);
  return menus.map((item) => {
    return {
      ...item,
      label: item.text,
      value: item.key,
    };
  });
});

// 刷新后如果不保持tab状态，关闭其他tab
if (!preferences.tabbar.persist) {
  tabbarStore.closeOtherTabs(route);
}
</script>

<template>
  <TabsView
    :active="currentActive"
    :class="theme"
    :context-menus="createContextMenus"
    :draggable="preferences.tabbar.draggable"
    :show-icon="showIcon"
    :style-type="preferences.tabbar.styleType"
    :tabs="currentTabs"
    :wheelable="preferences.tabbar.wheelable"
    :middle-click-to-close="preferences.tabbar.middleClickToClose"
    @close="handleClose"
    @sort-tabs="tabbarStore.sortTabs"
    @unpin="unpinTab"
    @update:active="handleClick"
  />
  <div class="flex-center h-full">
    <TabsToolMore v-if="preferences.tabbar.showMore" :menus="menus" />
    <TabsToolRefresh
      v-if="preferences.tabbar.showRefresh"
      @refresh="refreshTab"
    />
    <TabsToolScreen
      v-if="preferences.tabbar.showMaximize"
      :screen="contentIsMaximize"
      @change="toggleMaximize"
      @update:screen="toggleMaximize"
    />
  </div>
</template>

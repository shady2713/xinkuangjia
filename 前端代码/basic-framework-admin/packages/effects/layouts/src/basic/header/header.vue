<script lang="ts" setup>
/**
 * 布局头部：按插槽序号升序渲染左右两侧入口，内置入口（刷新、搜索、偏好、主题、时区、
 * 全屏、通知、用户下拉）各自受偏好开关控制，业务方以 header-left-n、header-right-n
 * 插槽追加。
 * 只做入口组装与事件透传，clearPreferencesAndLogout 抛给上层，面包屑与横向菜单也由
 * BasicLayout 注入，各入口自身行为不在这里实现。
 */
import { computed, useSlots } from 'vue';

import { useRefresh } from '@vben/hooks';
import { RotateCw } from '@vben/icons';
import { preferences, usePreferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';

import { VbenFullScreen, VbenIconButton } from '@vben-core/shadcn-ui';

import {
  GlobalSearch,
  PreferencesButton,
  ThemeToggle,
  TimezoneButton,
} from '../../widgets';

interface Props {
  /**
   * Logo 主题
   */
  theme?: string;
}

defineOptions({
  name: 'LayoutHeader',
});

withDefaults(defineProps<Props>(), {
  theme: 'light',
});

const emit = defineEmits<{ clearPreferencesAndLogout: [] }>();

const REFERENCE_VALUE = 50;

const accessStore = useAccessStore();
const { globalSearchShortcutKey, preferencesButtonPosition } = usePreferences();
const slots = useSlots();
const { refresh } = useRefresh();

const rightSlots = computed(
  /**
   * 汇总头部右侧要渲染的入口：内置入口按各偏好开关决定是否加入，
   * 业务方注入的 header-right-<序号> 插槽按序号并入，序号越小越靠左。
   * @returns 已按 index 升序排列的右侧插槽清单。
   */
  () => {
    const list = [{ index: REFERENCE_VALUE + 100, name: 'user-dropdown' }];
    if (preferences.widget.globalSearch) {
      list.push({
        index: REFERENCE_VALUE,
        name: 'global-search',
      });
    }

    if (preferencesButtonPosition.value.header) {
      list.push({
        index: REFERENCE_VALUE + 10,
        name: 'preferences',
      });
    }
    if (preferences.widget.themeToggle) {
      list.push({
        index: REFERENCE_VALUE + 20,
        name: 'theme-toggle',
      });
    }
    if (preferences.widget.timezone) {
      list.push({
        index: REFERENCE_VALUE + 30,
        name: 'timezone',
      });
    }
    if (preferences.widget.fullscreen) {
      list.push({
        index: REFERENCE_VALUE + 50,
        name: 'fullscreen',
      });
    }
    if (preferences.widget.notification) {
      list.push({
        index: REFERENCE_VALUE + 60,
        name: 'notification',
      });
    }

    Object.keys(slots).forEach(
      /**
       * 并入业务方注入的 header-right-<序号> 插槽，序号取自插槽名中的第二段，
       * 未按该前缀命名的插槽不属于右侧入口。
       */
      (key) => {
        const name = key.split('-');
        if (key.startsWith('header-right')) {
          list.push({ index: Number(name[2]), name: key });
        }
      },
    );
    return list.toSorted(
      /** 按序号升序排列，使内置入口与业务插槽的相对位置保持稳定。 */
      (a, b) => a.index - b.index,
    );
  },
);

const leftSlots = computed(() => {
  const list: Array<{ index: number; name: string }> = [];

  if (preferences.widget.refresh) {
    list.push({
      index: 0,
      name: 'refresh',
    });
  }

  Object.keys(slots).forEach((key) => {
    const name = key.split('-');
    if (key.startsWith('header-left')) {
      list.push({ index: Number(name[2]), name: key });
    }
  });
  return list.toSorted((a, b) => a.index - b.index);
});

function clearPreferencesAndLogout() {
  emit('clearPreferencesAndLogout');
}
</script>

<template>
  <template
    v-for="slot in leftSlots.filter((item) => item.index < REFERENCE_VALUE)"
    :key="slot.name"
  >
    <slot :name="slot.name">
      <template v-if="slot.name === 'refresh'">
        <VbenIconButton class="my-0 mr-1 rounded-md" @click="refresh">
          <RotateCw class="size-4" />
        </VbenIconButton>
      </template>
    </slot>
  </template>
  <div class="flex-center hidden lg:block">
    <slot name="breadcrumb"></slot>
  </div>
  <template
    v-for="slot in leftSlots.filter((item) => item.index > REFERENCE_VALUE)"
    :key="slot.name"
  >
    <slot :name="slot.name"></slot>
  </template>
  <div
    :class="`menu-align-${preferences.header.menuAlign}`"
    class="flex h-full min-w-0 flex-1 items-center"
  >
    <slot name="menu"></slot>
  </div>
  <div class="flex h-full min-w-0 flex-shrink-0 items-center">
    <template v-for="slot in rightSlots" :key="slot.name">
      <slot :name="slot.name">
        <template v-if="slot.name === 'global-search'">
          <GlobalSearch
            :enable-shortcut-key="globalSearchShortcutKey"
            :menus="accessStore.accessMenus"
            class="mr-1 sm:mr-4"
          />
        </template>

        <template v-else-if="slot.name === 'preferences'">
          <PreferencesButton
            class="mr-1"
            @clear-preferences-and-logout="clearPreferencesAndLogout"
          />
        </template>
        <template v-else-if="slot.name === 'theme-toggle'">
          <ThemeToggle class="mr-1 mt-[2px]" />
        </template>
        <template v-else-if="slot.name === 'timezone'">
          <TimezoneButton class="mr-1" />
        </template>
        <template v-else-if="slot.name === 'fullscreen'">
          <VbenFullScreen class="mr-1" />
        </template>
      </slot>
    </template>
  </div>
</template>
<style lang="scss" scoped>
.menu-align-start {
  --menu-align: start;
}

.menu-align-center {
  --menu-align: center;
}

.menu-align-end {
  --menu-align: end;
}
</style>

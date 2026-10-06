<script setup lang="ts">
/**
 * 头部用户下拉：展示头像、描述与调用方传入的菜单，并内置锁屏与退出登录两项。
 * 偏好开启时 Alt+L、Alt+Q 可唤起对应弹窗，快捷键还受 enableShortcutKey 开关控制。
 * 只对外 emit logout 并打开锁屏弹窗，会话清理与路由跳转由使用方处理，
 * 锁屏密码校验交给 LockScreenModal，本组件不接触凭据。
 */
import type { Component } from 'vue';

import type { AnyFunction } from '@vben/types';

import { computed, useTemplateRef, watch } from 'vue';

import { useHoverToggle } from '@vben/hooks';
import { LockKeyhole, LogOut } from '@vben/icons';
import { $t } from '@vben/locales';
import { preferences, usePreferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';
import { isWindowsOs } from '@vben/utils';

import { useVbenModal } from '@vben-core/popup-ui';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  VbenAvatar,
  VbenIcon,
} from '@vben-core/shadcn-ui';

import { useMagicKeys, whenever } from '@vueuse/core';

import { LockScreenModal } from '../lock-screen';

/** 用户下拉属性：头像与描述、自定义菜单项、标签文案，以及触发方式、hover 延迟与快捷键开关。 */
interface Props {
  /**
   * 头像
   */
  avatar?: string;
  /**
   * @zh_CN 描述
   */
  description?: string;
  /**
   * 是否启用快捷键
   */
  enableShortcutKey?: boolean;
  /**
   * 菜单数组
   */
  menus?: Array<{
    handler: AnyFunction;
    // 函数形态的图标就是函数式组件，Component 已覆盖 FunctionalComponent。
    icon?: Component | string;
    text: string;
  }>;

  /**
   * 标签文本
   */
  tagText?: string;
  /**
   * 文本
   */
  text?: string;
  /** 触发方式 */
  trigger?: 'both' | 'click' | 'hover';
  /** hover触发时，延迟响应的时间 */
  hoverDelay?: number;
}

defineOptions({
  name: 'UserDropdown',
});

const props = withDefaults(defineProps<Props>(), {
  avatar: '',
  description: '',
  enableShortcutKey: true,
  /** 菜单项的默认值：空数组，未传入时不渲染任何自定义菜单项。 */
  menus: () => [],
  showShortcutKey: true,
  tagText: '',
  text: '',
  trigger: 'click',
  hoverDelay: 500,
});

const emit = defineEmits<{ logout: [] }>();

const { globalLockScreenShortcutKey, globalLogoutShortcutKey } =
  usePreferences();
const accessStore = useAccessStore();
const [LockModal, lockModalApi] = useVbenModal({
  connectedComponent: LockScreenModal,
});
const [LogoutModal, logoutModalApi] = useVbenModal({
  /** 确认退出登录：转发给统一的退出处理。 */
  onConfirm() {
    handleSubmitLogout();
  },
});

const refTrigger = useTemplateRef('refTrigger');
const refContent = useTemplateRef('refContent');
/** 悬浮触发时按需读取最新延迟毫秒数，使运行期修改 hoverDelay 立即生效。 */
const [openPopover, hoverWatcher] = useHoverToggle(
  [refTrigger, refContent],
  () => props.hoverDelay,
);

watch(
  () => props.trigger === 'hover' || props.trigger === 'both',
  (val) => {
    if (val) {
      hoverWatcher.enable();
    } else {
      hoverWatcher.disable();
    }
  },
  {
    immediate: true,
  },
);

/** 快捷键提示前缀：Windows 显示 Alt，其他平台显示 ⌥。 */
const altView = computed(() => (isWindowsOs() ? 'Alt' : '⌥'));

/** 是否启用退出登录快捷键：需组件开关与全局退出快捷键同时开启。 */
const enableLogoutShortcutKey = computed(() => {
  return props.enableShortcutKey && globalLogoutShortcutKey.value;
});

/** 是否启用锁屏快捷键：需组件开关与全局锁屏快捷键同时开启。 */
const enableLockScreenShortcutKey = computed(() => {
  return props.enableShortcutKey && globalLockScreenShortcutKey.value;
});

/** 是否启用任意快捷键：需组件开关与偏好中的快捷键总开关同时开启。 */
const enableShortcutKey = computed(() => {
  return props.enableShortcutKey && preferences.shortcutKeys.enable;
});

/** 打开锁屏弹窗；密码校验由弹窗内部完成。 */
function handleOpenLock() {
  lockModalApi.open();
}

/** 提交锁屏密码：先关闭弹窗，再把密码交给状态层进入锁屏。 */
function handleSubmitLock(lockScreenPassword: string) {
  lockModalApi.close();
  accessStore.lockScreen(lockScreenPassword);
}

/** 打开退出登录确认弹窗并收起用户下拉；真正的退出发生在确认之后。 */
function handleLogout() {
  // emit
  logoutModalApi.open();
  openPopover.value = false;
}

/** 确认退出：向父级抛 logout 事件并关闭确认弹窗。 */
function handleSubmitLogout() {
  emit('logout');
  logoutModalApi.close();
}

if (enableShortcutKey.value) {
  const keys = useMagicKeys();
  // useMagicKeys 以 Proxy 惰性创建组合键，索引结果在类型上仍是可选的；
  // 缺失时跳过注册即可，运行时这些组合键始终由 useMagicKeys 提供
  const logoutKey = keys['Alt+KeyQ'];
  if (logoutKey) {
    whenever(
      logoutKey,
      /**
       * Alt+Q 命中后按开关决定是否注销，避免与用户手动点击菜单项重复触发。
       */
      () => {
        if (enableLogoutShortcutKey.value) {
          handleLogout();
        }
      },
    );
  }

  const lockKey = keys['Alt+KeyL'];
  if (lockKey) {
    whenever(
      lockKey,
      /**
       * Alt+L 命中后按开关决定是否打开锁屏弹窗。
       */
      () => {
        if (enableLockScreenShortcutKey.value) {
          handleOpenLock();
        }
      },
    );
  }
}
</script>

<template>
  <LockModal
    v-if="preferences.widget.lockScreen"
    :avatar="avatar"
    :text="text"
    @submit="handleSubmitLock"
  />

  <LogoutModal
    :cancel-text="$t('common.cancel')"
    :confirm-text="$t('common.confirm')"
    :fullscreen-button="false"
    :title="$t('common.prompt')"
    centered
    content-class="px-8 min-h-10"
    footer-class="border-none mb-3 mr-3"
    header-class="border-none"
  >
    {{ $t('ui.widgets.logoutTip') }}
  </LogoutModal>

  <DropdownMenu v-model:open="openPopover">
    <DropdownMenuTrigger ref="refTrigger" :disabled="props.trigger === 'hover'">
      <div class="hover:bg-accent ml-1 mr-2 cursor-pointer rounded-full p-1.5">
        <div class="hover:text-accent-foreground flex-center">
          <VbenAvatar :alt="text" :src="avatar" class="size-8" dot />
        </div>
      </div>
    </DropdownMenuTrigger>
    <DropdownMenuContent class="mr-2 min-w-[240px] p-0 pb-1">
      <div ref="refContent">
        <DropdownMenuLabel class="flex items-center p-3">
          <VbenAvatar
            :alt="text"
            :src="avatar"
            class="size-12"
            dot
            dot-class="bottom-0 right-1 border-2 size-4 bg-green-500"
          />
          <div class="ml-2 w-full">
            <div
              v-if="tagText || text || $slots.tagText"
              class="text-foreground mb-1 flex items-center text-sm font-medium"
            >
              {{ text }}
              <slot name="tagText">
                <Badge v-if="tagText" class="ml-2 text-green-400">
                  {{ tagText }}
                </Badge>
              </slot>
            </div>
            <div class="text-muted-foreground text-xs font-normal">
              {{ description }}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator v-if="menus?.length" />
        <DropdownMenuItem
          v-for="menu in menus"
          :key="menu.text"
          class="mx-1 flex cursor-pointer items-center rounded-sm py-1 leading-8"
          @click="menu.handler"
        >
          <VbenIcon :icon="menu.icon" class="mr-2 size-4" />
          {{ menu.text }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          v-if="preferences.widget.lockScreen"
          class="mx-1 flex cursor-pointer items-center rounded-sm py-1 leading-8"
          @click="handleOpenLock"
        >
          <LockKeyhole class="mr-2 size-4" />
          {{ $t('ui.widgets.lockScreen.title') }}
          <DropdownMenuShortcut v-if="enableLockScreenShortcutKey">
            {{ altView }} L
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="preferences.widget.lockScreen" />
        <DropdownMenuItem
          class="mx-1 flex cursor-pointer items-center rounded-sm py-1 leading-8"
          @click="handleLogout"
        >
          <LogOut class="mr-2 size-4" />
          {{ $t('common.logout') }}
          <DropdownMenuShortcut v-if="enableLogoutShortcutKey">
            {{ altView }} Q
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

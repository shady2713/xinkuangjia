/**
 * 应用界面局部状态（侧边栏折叠、悬停展开开关、会话级锁屏状态）。
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(false);
  /** 折叠态下是否允许鼠标悬停自动临时展开（对齐原版 Vben 5 sidebar.expandOnHover） */
  const sidebarExpandOnHover = ref(true);
  /** 会话级锁屏状态（仅驻留内存，避免口令落盘） */
  const isLockScreen = ref(false);
  const lockScreenSecret = ref('');

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function toggleSidebarExpandOnHover() {
    sidebarExpandOnHover.value = !sidebarExpandOnHover.value;
  }

  function lockScreen(password: string) {
    lockScreenSecret.value = password;
    isLockScreen.value = true;
  }

  function unlockScreen(password: string): boolean {
    if (password !== lockScreenSecret.value) {
      return false;
    }
    isLockScreen.value = false;
    lockScreenSecret.value = '';
    return true;
  }

  function resetLockScreen() {
    isLockScreen.value = false;
    lockScreenSecret.value = '';
  }

  return {
    sidebarCollapsed,
    sidebarExpandOnHover,
    isLockScreen,
    toggleSidebar,
    toggleSidebarExpandOnHover,
    lockScreen,
    unlockScreen,
    resetLockScreen,
  };
});

/**
 * 权限判定组合式函数：按用户角色或权限码判断当前登录者能否访问，
 * 并可在前后端两种鉴权模式间切换，供 v-access 指令与业务按钮复用。
 * 只读取用户与权限仓库的既有数据，不负责权限数据的拉取与写入。
 */
import { computed } from 'vue';

import { preferences, updatePreferences } from '@vben/preferences';
import { useAccessStore, useUserStore } from '@vben/stores';

/**
 * 读取当前鉴权模式并暴露角色、权限码判定与模式切换方法。
 * 判定只读用户与权限仓库的既有数据，未登录或数据未加载时按无权限处理。
 * @returns 当前鉴权模式、两类判定函数以及前后端模式切换方法。
 */
function useAccess() {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  /** 当前生效的鉴权模式（frontend 或 backend），随偏好设置变化实时更新。 */
  const accessMode = computed(() => {
    return preferences.app.accessMode;
  });

  /**
   * 基于角色判断是否有权限
   * @description: Determine whether there is permission，The role is judged by the user's role
   * @param roles
   */
  function hasAccessByRoles(roles: string[]) {
    const userRoleSet = new Set(userStore.userRoles);
    /** 用户角色与要求角色的交集；非空即视为命中，用户无角色时恒为空。 */
    const intersection = roles.filter((item) => userRoleSet.has(item));
    return intersection.length > 0;
  }

  /**
   * 基于权限码判断是否有权限
   * @description: Determine whether there is permission，The permission code is judged by the user's permission code
   * @param codes
   */
  function hasAccessByCodes(codes: string[]) {
    const userCodesSet = new Set(accessStore.accessCodes);

    /** 用户权限码与要求权限码的交集；非空即视为命中，权限未加载时恒为空。 */
    const intersection = codes.filter((item) => userCodesSet.has(item));
    return intersection.length > 0;
  }

  /** 在 frontend 与 backend 两种鉴权模式间切换并持久化偏好；写入后需重新登录或拉取权限才会生效。 */
  async function toggleAccessMode() {
    updatePreferences({
      app: {
        accessMode:
          preferences.app.accessMode === 'frontend' ? 'backend' : 'frontend',
      },
    });
  }

  return {
    accessMode,
    hasAccessByCodes,
    hasAccessByRoles,
    toggleAccessMode,
  };
}

export { useAccess };

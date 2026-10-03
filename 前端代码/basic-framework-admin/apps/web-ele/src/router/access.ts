import type {
  ComponentRecordType,
  GenerateMenuAndRoutesOptions,
} from '@vben/types';

import { generateAccessible } from '@vben/access';
import { preferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';
import {
  cloneDeep,
  convertServerMenuToRouteRecordStringComponent,
} from '@vben/utils';

import { BasicLayout, IFrameView } from '#/layouts';

/** 按需加载权限拒绝页面。 */
const forbiddenComponent = () => import('#/views/_core/fallback/forbidden.vue');

/** 按当前身份菜单生成权限路由，安装前由调用方验证会话是否仍有效。
 * @param options 路由来源及当前会话校验函数。
 * @returns 安装的权限路由与菜单；失效身份不会安装路由。
 */
async function generateAccess(
  options: {
    /** 安装前确认发起身份仍有效。 */ isCurrent: () => boolean;
  } & GenerateMenuAndRoutesOptions,
) {
  const pageMap: ComponentRecordType = import.meta.glob('../views/**/*.vue');
  const accessStore = useAccessStore();

  const layoutMap: ComponentRecordType = {
    BasicLayout,
    IFrameView,
  };

  return await generateAccessible(preferences.app.accessMode, {
    ...options,
    /** 从当前身份原始菜单的副本生成路由，避免转换时修改 Store 的服务端数据。 */
    fetchMenuListAsync: async () => {
      const accessMenus = cloneDeep(accessStore.serverMenus);
      return convertServerMenuToRouteRecordStringComponent(accessMenus);
    },
    // 可以指定没有权限跳转403页面
    forbiddenComponent,
    // 如果 route.meta.menuVisibleWithForbidden = true
    layoutMap,
    pageMap,
  });
}

export { generateAccess };

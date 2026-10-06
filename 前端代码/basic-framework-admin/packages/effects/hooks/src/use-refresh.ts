/**
 * 页面刷新入口：委托标签栏 store 重建当前路由的视图。
 *
 * 只转发刷新动作，数据重取与缓存清理由页面自身负责。
 */
import { useRouter } from 'vue-router';

import { useTabbarStore } from '@vben/stores';

export function useRefresh() {
  const router = useRouter();
  const tabbarStore = useTabbarStore();

  async function refresh() {
    await tabbarStore.refresh(router);
  }

  return {
    refresh,
  };
}

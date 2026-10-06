/**
 * 页面刷新入口：委托标签栏 store 重建当前路由的视图。
 *
 * 只转发刷新动作，数据重取与缓存清理由页面自身负责。
 */
import { useRouter } from 'vue-router';

import { useTabbarStore } from '@vben/stores';

/**
 * 提供刷新当前页面的方法，刷新动作交给标签栏 store 重建路由视图。
 * @returns 无参异步刷新方法；完成后当前路由组件重新挂载，页面数据需自行重新拉取。
 */
export function useRefresh() {
  const router = useRouter();
  const tabbarStore = useTabbarStore();

  /** 刷新当前路由视图；由标签栏 store 重建组件，页面缓存与请求需由调用方自行处理。 */
  async function refresh() {
    await tabbarStore.refresh(router);
  }

  return {
    refresh,
  };
}

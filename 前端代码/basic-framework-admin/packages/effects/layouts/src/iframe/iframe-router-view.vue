<script lang="ts" setup>
/**
 * 内嵌 IFrame 路由视图容器：按 tabbar 与 keepAlive 状态复用渲染，并强制协议校验与同源沙箱隔离。
 */
import type { RouteLocationNormalized } from 'vue-router';

import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';

import { preferences } from '@vben/preferences';
import { useTabbarStore } from '@vben/stores';

import { VbenSpinner } from '@vben-core/shadcn-ui';

import { resolveIframeSandbox, resolveSafeIframeSrc } from './iframe-security';

defineOptions({ name: 'IFrameRouterView' });

const spinningList = ref<boolean[]>([]);
const tabbarStore = useTabbarStore();
const route = useRoute();
const currentOrigin =
  typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

const enableTabbar = computed(() => preferences.tabbar.enable);

const iframeRoutes = computed(() => {
  if (!enableTabbar.value) {
    return route.meta.iframeSrc ? [route] : [];
  }
  return tabbarStore.getTabs.filter((tab) => !!tab.meta?.iframeSrc);
});

const tabNames = computed(
  () => new Set(iframeRoutes.value.map((item) => item.name as string)),
);

const showIframe = computed(() => iframeRoutes.value.length > 0);

/**
 * 判断当前 tab 路由是否为激活显示页。
 *
 * @param tabItem 标签页路由记录
 * @returns 与当前路由同名时返回 true
 */
function routeShow(tabItem: RouteLocationNormalized) {
  return tabItem.name === route.name;
}

/**
 * 判断指定内嵌路由页当前是否允许挂载或保持渲染。
 *
 * @param tabItem 标签页路由记录
 * @returns 允许渲染返回 true
 */
function canRender(tabItem: RouteLocationNormalized) {
  const { meta, name } = tabItem;

  if (!name || !tabbarStore.renderRouteView) {
    return false;
  }

  if (!enableTabbar.value) {
    return routeShow(tabItem);
  }

  // 跟随 keepAlive 状态,与其他tab页保持一致
  if (
    !meta?.keepAlive &&
    tabNames.value.has(name as string) &&
    name !== route.name
  ) {
    return false;
  }
  return tabbarStore.getTabs.some((tab) => tab.name === name);
}

/**
 * 隐藏指定索引 iframe 的加载动画。
 *
 * @param index 当前渲染列表下标
 */
function hideLoading(index: number) {
  spinningList.value[index] = false;
}

/**
 * 返回指定索引 iframe 当前是否应展示加载中遮罩。
 *
 * @param index 当前渲染列表下标
 * @returns 首次加载或仍处于 loading 时返回 true
 */
function showSpinning(index: number) {
  const curSpinning = spinningList.value[index];
  // 首次加载时显示loading
  return curSpinning === undefined ? true : curSpinning;
}

/**
 * 解析并过滤路由配置的安全 iframe 地址。
 *
 * @param tabItem 标签页路由记录
 * @returns 安全的 iframe URL；协议非法时返回空字符串
 */
function getSafeIframeSrc(tabItem: RouteLocationNormalized): string {
  return resolveSafeIframeSrc(tabItem.meta?.iframeSrc);
}

/**
 * 根据目标地址是否同源生成最小权限 iframe sandbox 属性。
 *
 * @param tabItem 标签页路由记录
 * @returns sandbox 属性策略值
 */
function getIframeSandbox(tabItem: RouteLocationNormalized): string {
  return resolveIframeSandbox(getSafeIframeSrc(tabItem), currentOrigin);
}
</script>
<template>
  <template v-if="showIframe">
    <template v-for="(item, index) in iframeRoutes" :key="item.fullPath">
      <div
        v-if="canRender(item) && getSafeIframeSrc(item)"
        v-show="routeShow(item)"
        class="relative size-full"
      >
        <VbenSpinner :spinning="showSpinning(index)" />
        <iframe
          :src="getSafeIframeSrc(item)"
          class="size-full"
          referrerpolicy="no-referrer"
          :sandbox="getIframeSandbox(item)"
          @load="hideLoading(index)"
        ></iframe>
      </div>
    </template>
  </template>
</template>

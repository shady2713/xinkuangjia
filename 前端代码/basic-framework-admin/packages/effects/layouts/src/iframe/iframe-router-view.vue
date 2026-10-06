<script lang="ts" setup>
/**
 * 内嵌页面宿主：为 iframeSrc 路由渲染 iframe，按标签保留实例。
 * 由内容区挂载，渲染与否跟随标签库的 keepAlive 开关；
 * 首次加载用遮罩提示，不代理请求也不改写路由。
 */
import type { RouteLocationNormalized } from 'vue-router';

import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';

import { preferences } from '@vben/preferences';
import { useTabbarStore } from '@vben/stores';

import { VbenSpinner } from '@vben-core/shadcn-ui';

defineOptions({ name: 'IFrameRouterView' });

const spinningList = ref<boolean[]>([]);
const tabbarStore = useTabbarStore();
const route = useRoute();

/** 标签栏是否启用：关闭时 iframe 只按当前路由渲染，不保留多标签实例。 */
const enableTabbar = computed(() => preferences.tabbar.enable);

/** 需要保留实例的 iframe 路由：标签栏关闭时只含当前路由，否则取标签库中带 iframeSrc 的标签。 */
const iframeRoutes = computed(() => {
  if (!enableTabbar.value) {
    return route.meta.iframeSrc ? [route] : [];
  }
  return tabbarStore.getTabs.filter((tab) => !!tab.meta?.iframeSrc);
});

/** 全部 iframe 路由的名称集合，用于判断某个标签是否已拥有独立实例。 */
const tabNames = computed(
  () => new Set(iframeRoutes.value.map((item) => item.name as string)),
);

/** 是否存在需要渲染的 iframe 路由；为空时不输出任何节点。 */
const showIframe = computed(() => iframeRoutes.value.length > 0);

/** 判断该标签是否为当前激活路由，用于切换 iframe 的显示与隐藏。 */
function routeShow(tabItem: RouteLocationNormalized) {
  return tabItem.name === route.name;
}

/**
 * 判断该 iframe 标签当前是否应当渲染。
 * @param tabItem 待判断的标签路由。
 * @returns 是否渲染；缺少路由名、路由视图被禁用，或已关闭 keepAlive 且不是当前标签时为 false。
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

/** iframe 加载完成后关闭对应下标的遮罩。 */
function hideLoading(index: number) {
  spinningList.value[index] = false;
}

/** 读取下标对应的遮罩状态；该下标尚未记录过（首次加载）时按需要显示处理。 */
function showSpinning(index: number) {
  const curSpinning = spinningList.value[index];
  // 首次加载时显示loading
  return curSpinning === undefined ? true : curSpinning;
}
</script>
<template>
  <template v-if="showIframe">
    <template v-for="(item, index) in iframeRoutes" :key="item.fullPath">
      <div
        v-if="canRender(item)"
        v-show="routeShow(item)"
        class="relative size-full"
      >
        <VbenSpinner :spinning="showSpinning(index)" />
        <iframe
          :src="item.meta.iframeSrc as string"
          class="size-full"
          @load="hideLoading(index)"
        ></iframe>
      </div>
    </template>
  </template>
</template>

<script lang="ts" setup>
/**
 * 管理端内容区：按标签页缓存清单渲染 RouterView，并解析切换动画名与视图组件名，
 * 让 keep-alive 能按路由名命中缓存；iframe 页面交给同级的 IFrameRouterView。
 * 只做内容编排，菜单、头部、页脚与加载遮罩分别由 basic 下其它目录提供。
 */
import type { VNode } from 'vue';
import type {
  RouteLocationNormalizedLoaded,
  RouteLocationNormalizedLoadedGeneric,
} from 'vue-router';

import { RouterView } from 'vue-router';

import { preferences, usePreferences } from '@vben/preferences';
import { getTabKey, storeToRefs, useTabbarStore } from '@vben/stores';

import { IFrameRouterView } from '../../iframe';

defineOptions({ name: 'LayoutContent' });

const tabbarStore = useTabbarStore();
const { keepAlive } = usePreferences();

const { getCachedTabs, getExcludeCachedTabs, renderRouteView } =
  storeToRefs(tabbarStore);

/**
 * 解析页面切换动画名。
 *
 * 动画名同时决定"是否套用过渡"与"过渡用哪个名字"：返回空值即表示本次不套用过渡。
 * 模板只读这一个入口，避免"是否启用"与"动画名"各判一次而在关闭动画时留下永不求值的分支。
 * @param _route 当前路由；动画名只由偏好设置决定，此参数为模板调用保持一致而保留
 * @returns 启用且配置了动画名时返回动画名，否则返回 undefined
 */
function getTransitionName(_route: RouteLocationNormalizedLoaded) {
  // 如果偏好设置未设置，则不使用动画
  const { tabbar, transition } = preferences;
  const transitionName = transition.name;
  if (!transitionName || !transition.enable) {
    return undefined;
  }

  // 标签页未启用或者未开启缓存，则使用全局配置动画
  if (!tabbar.enable || !keepAlive) {
    return transitionName;
  }

  // 如果页面已经加载过，则不使用动画
  // if (route.meta.loaded) {
  //   return;
  // }
  // 已经打开且已经加载过的页面不使用动画
  // const inTabs = getCachedTabs.value.includes(route.name as string);

  // return inTabs && route.meta.loaded ? undefined : transitionName;
  return transitionName;
}

/**
 * 为路由视图组件补上 name，供 keep-alive 与标签页缓存按名称索引。
 * 组件自身已声明 name 时保持原样；路由无名时不做处理。
 * @param component RouterView 渲染出的组件节点
 * @param route 当前路由，用于取路由名作为组件名
 * @returns 补名后的组件节点；组件缺失或路由无名时原样返回
 */
function transformComponent(
  component: VNode,
  route: RouteLocationNormalizedLoadedGeneric,
) {
  // 组件视图未找到，如果有设置后备视图，则返回后备视图，如果没有，则抛出错误
  if (!component) {
    console.error(
      'Component view not found，please check the route configuration',
    );
    return undefined;
  }

  const routeName = route.name as string;
  // 如果组件没有 name，则直接返回
  if (!routeName) {
    return component;
  }
  // 视图组件的 type 可能是组件对象，也可能还没挂载；先取一次 name 判断是否已命名。
  const componentType = component.type as undefined | { name?: string };
  const componentName = componentType?.name;

  // 视图组件已经按路由名命名时无需补名；先判同名，再判"已声明过 name"，
  // 两条判定都能在真实路由表上命中，且都只返回原节点、不改写组件名。
  if (componentName === routeName) {
    return component;
  }

  // 已经设置过 name，则直接返回
  if (componentName) {
    return component;
  }

  // 设置 name
  component.type ||= {};
  (component.type as { name?: string }).name = routeName;

  return component;
}
</script>

<template>
  <div class="relative h-full">
    <IFrameRouterView />
    <RouterView v-slot="{ Component, route }">
      <Transition
        v-if="getTransitionName(route)"
        :name="getTransitionName(route)"
        appear
        mode="out-in"
      >
        <KeepAlive
          v-if="keepAlive"
          :exclude="getExcludeCachedTabs"
          :include="getCachedTabs"
        >
          <component
            :is="transformComponent(Component, route)"
            v-if="renderRouteView"
            v-show="!route.meta.iframeSrc"
            :key="getTabKey(route)"
          />
        </KeepAlive>
        <component
          :is="Component"
          v-else-if="renderRouteView"
          :key="getTabKey(route)"
        />
      </Transition>
      <template v-else>
        <KeepAlive
          v-if="keepAlive"
          :exclude="getExcludeCachedTabs"
          :include="getCachedTabs"
        >
          <component
            :is="transformComponent(Component, route)"
            v-if="renderRouteView"
            v-show="!route.meta.iframeSrc"
            :key="getTabKey(route)"
          />
        </KeepAlive>
        <component
          :is="Component"
          v-else-if="renderRouteView"
          :key="getTabKey(route)"
        />
      </template>
    </RouterView>
  </div>
</template>

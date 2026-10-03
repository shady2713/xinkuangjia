/** 路由辅助：把 views 下的组件文件按路径注册为异步组件，并归一化路由匹配结果。 */
import type { Component } from 'vue';
import type {
  RouteLocationNormalized,
  RouteRecordNormalized,
} from 'vue-router';

import { defineAsyncComponent } from 'vue';

/** views 下所有可作为路由组件的文件，值为返回该组件模块的加载函数。 */
const modules = import.meta.glob<{ default: Component }>(
  '../views/**/*.{vue,tsx}',
);

/**
 * 按路径注册异步组件。
 *
 * 遍历 views 下的 glob 结果，命中包含该路径的条目即返回异步组件；
 * 路径匹配到多个文件时返回第一个，匹配不到返回 undefined，由调用方决定后续处理。
 *
 * @param componentPath 组件路径片段，例：/bpm/oa/leave/detail
 * @returns 命中的异步组件定义；未命中时为 undefined
 */
export function registerComponent(componentPath: string) {
  for (const item in modules) {
    const loader = modules[item];
    if (item.includes(componentPath) && loader) {
      // 使用异步组件的方式来动态加载组件
      return defineAsyncComponent(loader);
    }
  }
}

export const getRawRoute = (
  route: RouteLocationNormalized,
): RouteLocationNormalized => {
  if (!route) return route;
  const { matched, ...opt } = route;
  return {
    ...opt,
    matched: (matched
      ? matched.map((item) => ({
          meta: item.meta,
          name: item.name,
          path: item.path,
        }))
      : undefined) as RouteRecordNormalized[],
  };
};

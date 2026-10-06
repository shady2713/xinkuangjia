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

/**
 * 产出可传输的路由副本：去掉归一化路由上无法序列化的部分，只保留匹配记录的标量字段。
 *
 * 除 matched 外的属性原样保留；matched 存在时逐条精简为 meta、name、path 三个字段，
 * 未匹配到任何记录时置为 undefined。
 *
 * @param route 当前归一化的路由对象；为空时原样返回
 * @returns 与入参同类型的新路由对象；入参为空时返回入参本身
 */
export const getRawRoute = (
  route: RouteLocationNormalized,
): RouteLocationNormalized => {
  if (!route) return route;
  const { matched, ...opt } = route;
  return {
    ...opt,
    /** 精简后的匹配记录；未匹配到任何记录时为 undefined。 */
    matched: (matched
      ? matched.map((item) => ({
          meta: item.meta,
          name: item.name,
          path: item.path,
        }))
      : undefined) as RouteRecordNormalized[],
  };
};

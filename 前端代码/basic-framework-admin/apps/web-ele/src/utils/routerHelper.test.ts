/**
 * 路由辅助（utils/routerHelper）真实行为回归。
 *
 * `registerComponent` 把后端菜单给的组件路径映射成 views 下的异步组件：路径匹配写错会让
 * 菜单点击后加载不到页面，匹配不到时必须返回 undefined 让调用方兜底；`getRawRoute`
 * 用于路由记录快照，裁剪规则写错会把整棵匹配链或额外字段带进缓存。用例使用真实
 * glob 结果与真实路由对象，只断言外部可观察的组件定义与裁剪结果；视图 SFC 的首次
 * 编译放在模块作用域完成，不占用单个用例的超时预算。
 *
 * 注意：本文件不能放在 `router/routes/modules/` 下——该目录被生产入口以 eager glob
 * 收集，测试文件会被打进产物。
 */
import type { RouteLocationNormalized } from 'vue-router';

import { describe, expect, it } from 'vitest';

import { getRawRoute, registerComponent } from './routerHelper';

/** 真实视图路径片段，命中 views 下的 glob 结果。 */
const MATCHED_PATH = '/system/user';
/** 轻量视图路径片段：该页面只依赖公共组件库，加载代价低且与菜单映射同源。 */
const FALLBACK_PATH = '/_core/fallback/not-found';
/** 确定不存在的路径片段，用于核对未命中时的返回值。 */
const MISSING_PATH = '/not-exist-view-path';

/** 异步组件加载入口的签名：调用后解析出真实页面组件。 */
type AsyncComponentLoader = () => Promise<unknown>;

/** 异步组件定义中 Vue 暴露的加载入口字段。 */
type AsyncComponentHolder = {
  __asyncLoader?: AsyncComponentLoader;
};

/**
 * 取出异步组件的真实加载入口。
 * @param component `registerComponent` 的返回值。
 * @returns 可调用的加载函数。
 * @throws 返回值不是异步组件定义时报告契约变化
 */
function loaderOf(component: unknown) {
  const loader = (component as AsyncComponentHolder | undefined)?.__asyncLoader;
  if (typeof loader !== 'function') {
    throw new TypeError('返回值不是异步组件定义');
  }
  return loader;
}

/**
 * 构造带额外字段的已匹配路由记录，用于核对裁剪结果。
 * @returns 已匹配的路由记录，含不应外泄的内部字段。
 */
function matchedRouteRecord() {
  return {
    components: { default: { name: 'UserView' } },
    instances: {},
    meta: { title: '用户管理' },
    name: 'SystemUser',
    path: '/system/user',
  };
}

// 首次解析真实视图会编译并求值对应 SFC，属于测试初始化成本；在模块作用域完成，
// 避免把冷加载计入用例的 5000ms 预算。用例仍调用真实加载函数并断言解析结果。
await loaderOf(registerComponent(FALLBACK_PATH))();

describe('registerComponent 注册异步组件', /** 菜单点击后的页面加载完全依赖该路径到视图文件的映射。 */ () => {
  it('命中视图路径时加载到对应页面组件', /** 返回 undefined 或加载到别的页面都会让菜单点击后渲染错误内容。 */ async () => {
    const component = registerComponent(FALLBACK_PATH);

    expect(component).toBeDefined();
    const resolved = (await loaderOf(component)()) as { name?: string };
    expect(resolved.name).toBe('Fallback404');
  });

  it('未命中视图路径时返回 undefined', /** 未命中必须交给调用方兜底，不能返回任意页面。 */ () => {
    expect(registerComponent(MISSING_PATH)).toBeUndefined();
  });

  it('不同视图路径对应不同的加载函数', /** 路径匹配若退化成"命中任意条目"，所有菜单都会打开同一个页面。 */ () => {
    const user = loaderOf(registerComponent(MATCHED_PATH));
    const fallback = loaderOf(registerComponent(FALLBACK_PATH));

    expect(fallback).not.toBe(user);
  });
});

describe('getRawRoute 裁剪路由快照', /** 路由快照用于记录与缓存，裁剪规则决定哪些字段会被保留。 */ () => {
  it('只保留匹配链的元信息、名称与路径', /** 内部实例与组件定义不能被带进快照。 */ () => {
    const route = {
      fullPath: '/system/user?page=1',
      matched: [matchedRouteRecord()],
      meta: { title: '用户管理' },
      name: 'SystemUser',
      params: { id: '1' },
      path: '/system/user',
      query: { page: '1' },
    } as unknown as RouteLocationNormalized;

    const raw = getRawRoute(route);

    expect(raw.matched).toEqual([
      { meta: { title: '用户管理' }, name: 'SystemUser', path: '/system/user' },
    ]);
    expect(raw.path).toBe('/system/user');
    expect(raw.fullPath).toBe('/system/user?page=1');
    expect(raw.query).toEqual({ page: '1' });
    expect(raw.params).toEqual({ id: '1' });
  });

  it('没有匹配链时保留 undefined', /** 未匹配到任何记录时不能伪造空数组，否则调用方无法区分两种情况。 */ () => {
    const route = {
      matched: undefined,
      meta: {},
      name: undefined,
      path: '/unmatched',
    } as unknown as RouteLocationNormalized;

    expect(getRawRoute(route).matched).toBeUndefined();
  });

  it('传入空路由时原样返回', /** 调用方可能传入尚未就绪的路由，守卫必须原样返回而不是抛错。 */ () => {
    expect(getRawRoute(null as unknown as RouteLocationNormalized)).toBeNull();
  });
});

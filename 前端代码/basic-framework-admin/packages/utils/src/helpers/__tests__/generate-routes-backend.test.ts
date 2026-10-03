/** 服务端路由描述通过真实转换器解析组件，并通过真实 Router 验证安装结果。 */
import type { RouteRecordStringComponent } from '@vben-core/typings';

import { createMemoryHistory, createRouter } from 'vue-router';

import { describe, expect, it } from 'vitest';

import { generateRoutesByBackend } from '../generate-routes-backend';

/** 模拟构建扫描得到的真实懒加载组件，不用字符串冒充 Vue 组件。 */
async function page() {
  return { name: 'FixturePage' };
}

/** 模拟缺失页面的可用兜底组件。 */
async function fallback() {
  return { name: 'FixtureFallback' };
}

describe('后端路由组件边界', /** 输入描述与安装记录必须是不同模型。 */ () => {
  it('递归解析子组件且不修改后端描述', /** 页面函数来自受控映射，原始字符串和树结构仍可再次使用。 */ async () => {
    const input: RouteRecordStringComponent[] = [
      {
        path: '/parent',
        name: 'parent',
        component: '',
        children: [{ path: 'child', name: 'child', component: 'system/page' }],
      },
    ];
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    const routes = await generateRoutesByBackend({
      router,
      routes: [],
      pageMap: { '../views/system/page.vue': page },
      /** 返回本例的后端配置对象。 */ fetchMenuListAsync: async () => input,
    });
    expect(routes[0]?.children?.[0]?.component).toBe(page);
    expect(input[0]?.children?.[0]?.component).toBe('system/page');
    for (const route of routes) router.addRoute(route);
    expect(router.resolve('/parent/child').matched).toHaveLength(2);
  });
  it('映射不存在的页面和对象原型键均使用显式兜底', /** 后端 component 不能解析为 layoutMap 继承的 constructor 或原型。 */ async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    const routes = await generateRoutesByBackend({
      router,
      routes: [],
      pageMap: { '/_core/fallback/not-found.vue': fallback },
      /** 使用原型同名值检查组件查表的所有权。 */ fetchMenuListAsync:
        async () => [
          { path: '/missing', name: 'missing', component: 'constructor' },
        ],
    });
    expect(routes[0]?.component).toBe(fallback);
  });
  it('没有页面也没有兜底时拒绝生成', /** 不把未解析字符串或 undefined 当作叶子页面交给 Router。 */ async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    await expect(
      generateRoutesByBackend({
        router,
        routes: [],
        /** 返回不能解析的页面标识。 */ fetchMenuListAsync: async () => [
          { path: '/missing', component: 'missing' },
        ],
      }),
    ).rejects.toThrow('路由页面及兜底页面不存在');
  });
  it('没有菜单数据时直接返回空数组并丢弃静态路由', /** 当前实现在合并静态路由之前就返回空数组，因此 options.routes 不会被带出。 */ async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    const staticRoute = { path: '/login', name: 'login' };

    const routes = await generateRoutesByBackend({
      /** 接口无数据时返回 undefined。 */ fetchMenuListAsync: async () =>
        undefined,
      router,
      routes: [staticRoute],
    });

    expect(routes).toEqual([]);
  });
  it('布局组件按 layoutMap 直接取用而不查页面表', /** 布局有独立映射，不能拿页面路径去页面表里找。 */ async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    /** 模拟布局的懒加载器。 */
    const layout = async () => ({ name: 'FixtureLayout' });

    const routes = await generateRoutesByBackend({
      /** 返回本例的后端菜单描述。 */
      fetchMenuListAsync: async () => [
        { component: 'BasicLayout', name: 'root', path: '/root' },
      ],
      layoutMap: { BasicLayout: layout },
      pageMap: {},
      router,
      routes: [],
    });

    expect(routes[0]?.component).toBe(layout);
  });
  it('页面标识带 .vue 后缀时按原样查表', /** 有些后端直接下发含后缀的路径，不能再补一次。 */ async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    /** 模拟叶子页面的懒加载器。 */
    const leaf = async () => ({ name: 'FixtureLeaf' });

    const routes = await generateRoutesByBackend({
      /** 返回本例的后端菜单描述。 */
      fetchMenuListAsync: async () => [
        { component: '/system/user.vue', name: 'user', path: '/user' },
      ],
      pageMap: { '/system/user.vue': leaf },
      router,
      routes: [],
    });

    expect(routes[0]?.component).toBe(leaf);
  });
  it('把 403 兜底组件替换到可见但无权限的菜单上', /** 让用户知悉功能存在并去申请权限，而不是看到空白页。 */ async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    /** 模拟 403 兜底组件。 */
    const forbidden = async () => ({ name: 'FixtureForbidden' });

    const routes = await generateRoutesByBackend({
      /** 返回本例的后端菜单描述。 */
      fetchMenuListAsync: async () => [
        {
          component: 'system/billing',
          meta: { menuVisibleWithForbidden: true },
          name: 'billing',
          path: '/billing',
        },
      ],
      forbiddenComponent: forbidden,
      pageMap: {
        /** 账单页面的懒加载器。 */
        '/system/billing.vue': async () => ({ name: 'Real' }),
      },
      router,
      routes: [],
    });

    expect(routes[0]?.component).toBe(forbidden);
  });
  it('未配置 403 兜底时保留原始页面组件', /** 没给兜底就不能替换，否则菜单会指向空组件。 */ async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [] });
    /** 模拟真实业务页面。 */
    const real = async () => ({ name: 'Real' });

    const routes = await generateRoutesByBackend({
      /** 返回本例的后端菜单描述。 */
      fetchMenuListAsync: async () => [
        {
          component: 'system/billing',
          meta: { menuVisibleWithForbidden: true },
          name: 'billing',
          path: '/billing',
        },
      ],
      pageMap: { '/system/billing.vue': real },
      router,
      routes: [],
    });

    expect(routes[0]?.component).toBe(real);
  });
});

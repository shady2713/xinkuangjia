/** 校验核心静态路由的路径、名称、跳转目标与懒加载组件工厂，防止登录前后页面外壳装配错误。
 *
 * 布局与页面模块的首次编译与求值放在模块作用域完成，属于测试初始化成本，不计入用例预算。
 */
import type { RouteRecordRaw } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';

import { describe, expect, it } from 'vitest';

import { coreRoutes, fallbackNotFoundRoute } from './core';

/** 路由懒加载工厂签名：调用后返回页面模块。 */
type LayoutLoader = () => Promise<unknown>;

/** 从路由声明中取出懒加载工厂；声明缺失或写成同步组件时立即失败，避免断言读到 undefined。 */
function componentLoader(route: RouteRecordRaw) {
  const loader = route.component;
  if (typeof loader !== 'function') {
    throw new TypeError(`路由 ${String(route.name)} 缺少懒加载组件工厂`);
  }
  return loader as LayoutLoader;
}

/** 按序号读取核心路由声明，缺失时立即失败而不是让断言读到 undefined。
 * @param index 核心路由在声明数组中的位置。
 * @returns 对应位置的路由声明。
 * @throws {Error} 声明数量少于预期时抛出。
 */
function coreRouteAt(index: number) {
  const route = coreRoutes[index];
  if (!route) throw new Error(`核心路由缺少第 ${index} 项声明`);
  return route;
}

/** 读取认证分组的子路由声明，缺失时立即失败。
 * @returns 认证分组的子路由列表。
 * @throws {Error} 认证分组或其子路由缺失时抛出。
 */
function authChildren() {
  const children = coreRouteAt(1).children;
  if (!children) throw new Error('认证分组缺少子路由声明');
  return children;
}

/**
 * 断言懒加载工厂能解析出 Vue 组件定义。
 * @param route 目标路由声明。
 */
async function expectResolvableComponent(route: RouteRecordRaw) {
  const module = (await componentLoader(route)()) as { default?: unknown };
  const component = module.default ?? module;
  expect(component).toBeTypeOf('object');
  expect(component).not.toBeNull();
}

// 核心路由的布局与页面在导入期读取运行时配置，必须在首次解析之前提供与 app.config.js
// 同形状的测试值；这里在模块作用域赋值，既早于下面的首次解析，也早于任何用例钩子。
// 测试文件各自隔离运行环境，因此该替身不会影响其他文件。
(
  globalThis as unknown as { _VBEN_ADMIN_PRO_APP_CONF_: unknown }
)._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_APP_CAPTCHA_ENABLE: 'false',
  VITE_APP_STORE_SECURE_KEY: 'DUMMY-store-key',
  VITE_GLOB_API_URL: 'https://example.test/admin-api',
  VITE_GLOB_AUTH_DINGDING_CLIENT_ID: '',
  VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
};

/**
 * 在用例预算之外完成核心路由布局与页面的首次解析。
 *
 * 这些模块的编译与求值属于测试初始化成本：放在用例体内时，并行采集下的冷启动会占用
 * 5000ms 用例预算；用例随后仍调用同一批真实懒加载工厂，只是命中已完成的模块缓存。
 * @throws 任一核心路由缺少懒加载工厂时抛出，与用例使用同一入口判定。
 */
async function warmCoreRouteComponents() {
  const routes = [
    fallbackNotFoundRoute,
    coreRouteAt(0),
    coreRouteAt(1),
    ...authChildren(),
  ];
  for (const route of routes) {
    await componentLoader(route)();
  }
}

await warmCoreRouteComponents();

describe('核心静态路由声明', /** 这组路由是应用骨架，任何字段变化都会直接影响登录跳转与兜底页面。 */ () => {
  it('全局兜底路由匹配任意剩余路径并隐藏于菜单与页签', /** 通配路径保证未知地址不会白屏，隐藏标记保证它不出现在导航中。 */ async () => {
    expect(fallbackNotFoundRoute.path).toBe('/:path(.*)*');
    expect(fallbackNotFoundRoute.name).toBe('FallbackNotFound');
    expect(fallbackNotFoundRoute.meta).toEqual({
      hideInBreadcrumb: true,
      hideInMenu: true,
      hideInTab: true,
      title: '404',
    });
    await expectResolvableComponent(fallbackNotFoundRoute);
  });

  it('根路由使用基础布局并跳转到偏好设置中的首页', /** 首页地址来自偏好配置，硬编码会让用户自定义首页失效。 */ async () => {
    const root = coreRouteAt(0);
    expect(root?.path).toBe('/');
    expect(root?.name).toBe('Root');
    expect(root?.redirect).toBe(preferences.app.defaultHomePath);
    expect(root?.meta).toEqual({ hideInBreadcrumb: true, title: 'Root' });
    expect(root.children).toEqual([]);
    await expectResolvableComponent(root);
  });

  it('认证分组使用认证页布局并跳转到登录页', /** 认证分组必须在未登录状态下可访问，并默认落到登录页。 */ async () => {
    const auth = coreRouteAt(1);
    expect(auth.path).toBe('/auth');
    expect(auth.name).toBe('Authentication');
    expect(auth.redirect).toBe(LOGIN_PATH);
    expect(auth.meta).toEqual({ hideInTab: true, title: 'Authentication' });
    await expectResolvableComponent(auth);
  });

  it('认证分组保持五个可懒加载的子页面与相对路径', /** 子路由名称与相对路径是登录、注册、找回密码等入口的跳转契约。 */ async () => {
    const children = authChildren();
    expect(
      children.map(
        /** 每个子路由取名称与相对路径两项契约。 */ (child) => [
          child.name,
          child.path,
        ],
      ),
    ).toEqual([
      ['Login', 'login'],
      ['CodeLogin', 'code-login'],
      ['ForgetPassword', 'forget-password'],
      ['Register', 'register'],
      ['SSOLogin', 'sso-login'],
    ]);
    for (const child of children) {
      expect(child.meta?.title).toBeTypeOf('string');
      await expectResolvableComponent(child);
    }
  });

  it('每条路由持有互相独立的懒加载工厂并返回 Promise', /** 工厂被复用会让多个路由指向同一页面，这里用引用集合与返回类型固定该契约。 */ () => {
    const routes = [
      fallbackNotFoundRoute,
      coreRouteAt(0),
      coreRouteAt(1),
      ...authChildren(),
    ];
    const loaders = routes.map(
      /** 逐条取出懒加载工厂用于引用比对。 */ (route) => componentLoader(route),
    );
    for (const loader of loaders) {
      expect(loader).toBeTypeOf('function');
      expect(loader()).toBeInstanceOf(Promise);
    }
    // 异步工厂被 vue-router 缓存前必须各自独立，共享引用说明某条路由复制了另一条。
    expect(new Set(loaders).size).toBe(routes.length);
  });
});

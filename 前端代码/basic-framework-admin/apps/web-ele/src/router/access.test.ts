/**
 * 应用权限路由入口（router/access.ts）的真实消费链路回归。
 *
 * `generateAccess` 是路由守卫生成权限菜单与路由的唯一入口：它把偏好里的权限模式、
 * Store 中的服务端原始菜单、真实页面与布局映射交给 `generateAccessible`。
 * 用例使用真实 Router、真实偏好对象与真实页面 glob，断言最终安装的路由、菜单与
 * 403 兜底页面懒加载结果，并核对 Store 中的服务端菜单不会被转换过程改写。
 */

import type { RouteRecordRaw } from 'vue-router';

import type { AppRouteRecordRaw } from '@vben/types';

import { createMemoryHistory, createRouter } from 'vue-router';

import { preferences, updatePreferences } from '@vben/preferences';
import { useAccessStore } from '@vben/stores';

import { createPinia, setActivePinia } from 'pinia';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import DictPage from '#/views/system/dict/index.vue';

import { generateAccess } from './access';

/** 懒加载页面组件：解析为真实页面模块的异步加载函数。 */
type PageLoader = () => Promise<{ default: unknown }>;
/** 403 兜底页面的懒加载函数，断言其解析结果携带固定注册名。 */
type ForbiddenLoader = () => Promise<{ default?: { name?: string } }>;

/** 运行时应用配置在模块导入期即被读取，这里提供最小测试值并保留原值以便恢复。 */
const appConfigGlobal = vi.hoisted(
  /** 写入最小运行时配置并记录原值，使接口与偏好模块能在无浏览器环境完成导入。 */ () => {
    const key = '_VBEN_ADMIN_PRO_APP_CONF_';
    const scope = globalThis as unknown as Record<string, unknown>;
    const previous = scope[key];
    scope[key] = {
      VITE_APP_CAPTCHA_ENABLE: 'false',
      VITE_APP_STORE_SECURE_KEY: 'DUMMY-store-key',
      VITE_GLOB_API_URL: 'https://example.test/admin-api',
      VITE_GLOB_AUTH_DINGDING_CLIENT_ID: '',
      VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
    };
    return { key, previous, scope };
  },
);

afterAll(
  /** 恢复全局运行时配置，避免影响同进程的其它测试文件。 */ () => {
    appConfigGlobal.scope[appConfigGlobal.key] = appConfigGlobal.previous;
  },
);

/** 创建带静态根的业务 Router，静态根用于挂载服务端菜单生成的子路由。 */
function newRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ name: 'Root', path: '/', component: {} }],
  });
}

/** 构造服务端权限菜单：一个布局父级加一个真实存在的页面子级。 */
function buildServerMenus(): AppRouteRecordRaw[] {
  return [
    {
      children: [
        {
          component: 'system/dict/index',
          id: 200,
          keepAlive: false,
          name: '字典管理',
          parentId: 100,
          path: 'dict',
          sort: 1,
          visible: true,
        },
      ],
      component: 'Layout',
      id: 100,
      keepAlive: false,
      name: '系统管理',
      parentId: 0,
      path: '/system',
      sort: 1,
      visible: true,
    },
  ];
}

describe('generateAccess 权限路由生成', /** 该入口决定登录后可见菜单与实际可访问路由。 */ () => {
  let originalAccessMode: (typeof preferences)['app']['accessMode'];

  beforeEach(
    /** 每例使用独立 Store 与前端权限模式，不继承上例状态。 */ () => {
      originalAccessMode = preferences.app.accessMode;
      setActivePinia(createPinia());
      updatePreferences({ app: { accessMode: 'frontend' } });
    },
  );
  afterEach(
    /** 恢复共享的权限模式，避免影响其它用例与持久化缓存。 */ () => {
      updatePreferences({ app: { accessMode: originalAccessMode } });
    },
  );

  it('后端模式按服务端菜单生成并安装路由，且不改写 Store 原始菜单', /** 服务端菜单是后续身份刷新与菜单渲染的唯一来源，转换必须操作副本。 */ async () => {
    updatePreferences({ app: { accessMode: 'backend' } });
    const router = newRouter();
    const accessStore = useAccessStore();
    const serverMenus = buildServerMenus();
    accessStore.setServerMenus(serverMenus);

    const { accessibleMenus, accessibleRoutes } = await generateAccess({
      /** 本次生成始终作用于当前身份。 */
      isCurrent: () => true,
      roles: [],
      router,
      routes: [],
    });

    expect(
      accessibleRoutes.map(
        /** 收集真实生成的路由路径。 */ (route) => route.path,
      ),
    ).toEqual(['/system']);
    expect(router.hasRoute('系统管理')).toBe(true);
    expect(
      router
        .resolve('/system/dict')
        .matched.map(
          /** 提取真实匹配链名称以证明子页面已安装。 */ (route) => route.name,
        ),
    ).toEqual(['Root', '系统管理', '字典管理']);
    // 布局父级带子路由时移除自身组件，避免出现多层 BasicLayout。
    const layoutRoute = accessibleRoutes[0];
    expect(layoutRoute?.component).toBeUndefined();
    // 页面子级必须由真实页面 glob 解析到实际的字典页面模块。
    const pageComponent = layoutRoute?.children?.[0]?.component as
      | PageLoader
      | undefined;
    expect(pageComponent).toBeTypeOf('function');
    const pageModule = await pageComponent?.();
    expect(pageModule?.default).toBe(DictPage);
    // 服务端原始菜单保持 'Layout' 与原路径，证明转换在副本上进行。
    expect(accessStore.serverMenus[0]?.component).toBe('Layout');
    expect(accessStore.serverMenus[0]?.path).toBe('/system');
    expect(serverMenus[0]?.children?.[0]?.path).toBe('dict');
    expect(
      accessibleMenus.map(/** 收集真实生成的菜单名称。 */ (menu) => menu.name),
    ).toEqual(['系统管理']);
  });

  it('前端模式把无权限但可见的菜单指向 403 兜底页面', /** 菜单可见性与访问权限分离时，进入页面必须看到明确的 403 而不是白屏。 */ async () => {
    const router = newRouter();
    const forbiddenRoute: RouteRecordRaw = {
      component: {},
      meta: {
        authority: ['super_admin'],
        menuVisibleWithForbidden: true,
        title: '仅可见无权限页面',
      },
      name: 'ForbiddenOnly',
      path: '/forbidden-only',
    };

    const { accessibleRoutes } = await generateAccess({
      /** 本次生成始终作用于当前身份。 */
      isCurrent: () => true,
      roles: ['normal_user'],
      router,
      routes: [forbiddenRoute],
    });

    const component = accessibleRoutes[0]?.component as
      | ForbiddenLoader
      | undefined;
    expect(component).toBeTypeOf('function');
    const loaded = await component?.();
    expect(loaded?.default?.name).toBe('Fallback403');
  });

  it('身份失效时不安装任何路由', /** 守卫在异步生成期间切换身份时必须丢弃结果，避免旧身份路由泄漏。 */ async () => {
    updatePreferences({ app: { accessMode: 'backend' } });
    const router = newRouter();
    const accessStore = useAccessStore();
    accessStore.setServerMenus(buildServerMenus());

    const result = await generateAccess({
      /** 本次生成期间身份已经被替换。 */
      isCurrent: () => false,
      roles: [],
      router,
      routes: [],
    });

    expect(result).toEqual({ accessibleMenus: [], accessibleRoutes: [] });
    expect(router.hasRoute('系统管理')).toBe(false);
    expect(
      router
        .getRoutes()
        .map(/** 收集 Router 中实际存在的记录名称。 */ (route) => route.name),
    ).toEqual(['Root']);
  });
});

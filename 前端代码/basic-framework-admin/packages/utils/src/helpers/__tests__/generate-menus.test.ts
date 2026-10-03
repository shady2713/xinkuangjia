/** 使用真实 Vue Router 验证菜单转换、排序、重定向与路由输入所有权。 */
import type { RouteRecordRaw } from 'vue-router';

import type { AppRouteRecordRaw } from '@vben-core/typings';

import { createMemoryHistory, createRouter } from 'vue-router';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  convertServerMenuToRouteRecordStringComponent,
  generateMenus,
} from '../generate-menus';

/** 每例从合法路由声明创建独立内存路由器。 */
function routerFor(routes: RouteRecordRaw[]) {
  return createRouter({ history: createMemoryHistory(), routes });
}

describe('真实路由到菜单的转换', /** 在独立展示树中验证可观察导航行为。 */ () => {
  it('保留标题、图标及附加元信息', /** 路由标题用于显示，名称只作为回退。 */ () => {
    const routes: RouteRecordRaw[] = [
      {
        component: {},
        path: '/profile',
        name: 'profile',
        meta: { title: 'Profile', icon: 'user-icon', order: 1, badge: 'new' },
      },
    ];
    expect(generateMenus(routes, routerFor(routes))).toMatchObject([
      {
        path: '/profile',
        name: 'Profile',
        icon: 'user-icon',
        order: 1,
        badge: 'new',
        children: [],
        show: true,
      },
    ]);
  });
  it('保留动态路径参数，不要求凭空生成参数值', /** 菜单只引用规范路由模式，不执行实际导航。 */ () => {
    const routes: RouteRecordRaw[] = [
      { component: {}, path: '/users/:userId', name: 'details' },
    ];
    expect(generateMenus(routes, routerFor(routes))[0]?.path).toBe(
      '/users/:userId',
    );
  });
  it('未隐藏子菜单时保留重定向入口自身路径', /** 普通重定向不是菜单隐式改址的依据。 */ () => {
    const routes: RouteRecordRaw[] = [
      { path: '/old', name: 'old', redirect: '/new' },
      { component: {}, path: '/new', name: 'new' },
    ];
    expect(
      generateMenus(routes, routerFor(routes)).map(
        /** 只比较用户实际点击的路径。 */ (menu) => menu.path,
      ),
    ).toEqual(['/old', '/new']);
  });
  it('零排序值有效，未声明排序的菜单置后', /** 避免使用真值判断把零误写成默认顺序。 */ () => {
    const routes: RouteRecordRaw[] = [
      { component: {}, path: '/last', name: 'last' },
      {
        component: {},
        path: '/one',
        name: 'one',
        meta: { title: 'One', order: 1 },
      },
      {
        component: {},
        path: '/zero',
        name: 'zero',
        meta: { title: 'Zero', order: 0 },
      },
    ];
    expect(
      generateMenus(routes, routerFor(routes)).map(
        /** 对比排序后的导航顺序。 */ (menu) => menu.path,
      ),
    ).toEqual(['/zero', '/one', '/last']);
  });
  it('嵌套菜单获得完整父路径且不改写路由 children', /** 展示模型不能回写 Router 输入或把子路由断言成菜单。 */ () => {
    const routes: RouteRecordRaw[] = [
      {
        component: {},
        path: '/root',
        name: 'root',
        children: [
          {
            component: {},
            path: 'child',
            name: 'child',
            children: [{ component: {}, path: 'leaf', name: 'leaf' }],
          },
          {
            component: {},
            path: 'hidden',
            name: 'hidden',
            meta: { title: 'Hidden', hideInMenu: true },
          },
        ],
      },
    ];
    const before = JSON.stringify(routes);
    const menus = generateMenus(routes, routerFor(routes));
    expect(menus[0]?.children).toHaveLength(1);
    expect(menus[0]?.children?.[0]).toMatchObject({
      path: '/root/child',
      parent: '/root',
      parents: ['/root'],
    });
    expect(menus[0]?.children?.[0]?.children?.[0]).toMatchObject({
      path: '/root/child/leaf',
      parents: ['/root', '/root/child'],
    });
    expect(JSON.stringify(routes)).toBe(before);
  });
  it('隐藏子菜单时解析对象重定向，函数重定向保留入口路径', /** 对象可静态解析，函数必须等实际导航上下文才能执行。 */ () => {
    const routes: RouteRecordRaw[] = [
      {
        component: {},
        path: '/group',
        name: 'group',
        meta: { title: 'Group', hideChildrenInMenu: true },
        redirect: { name: 'target', query: { q: 'x' } },
        children: [{ component: {}, path: 'child', name: 'child' }],
      },
      { component: {}, path: '/target', name: 'target' },
      {
        component: {},
        path: '/dynamic',
        name: 'dynamic',
        meta: { title: 'Dynamic', hideChildrenInMenu: true },
        /** 动态重定向仅供实际 Router 导航使用。 */ redirect: () => '/target',
      },
    ];
    const menus = generateMenus(routes, routerFor(routes));
    expect(menus[0]).toMatchObject({ path: '/target?q=x', children: [] });
    expect(menus[2]?.path).toBe('/dynamic');
  });
  it('空路由返回空菜单', /** 无权限路由时保持无菜单结果。 */ () => {
    expect(generateMenus([], routerFor([]))).toEqual([]);
  });
});

afterEach(
  /** 恢复真实控制台，避免重名告警 Spy 影响其它用例。 */ () => {
    vi.restoreAllMocks();
  },
);

/** 构造一条合法的服务端菜单，调用方只需覆盖关心的字段。
 * @param overrides 需要覆盖的字段。
 * @returns 可直接传给转换函数的菜单描述。
 */
function serverMenu(
  overrides: Partial<AppRouteRecordRaw> = {},
): AppRouteRecordRaw {
  return {
    icon: 'user-icon',
    id: 1,
    keepAlive: false,
    name: '用户管理',
    parentId: 0,
    path: 'system',
    sort: 1,
    visible: true,
    ...overrides,
  };
}

describe('convertServerMenuToRouteRecordStringComponent', /** 把已校验的服务端菜单转成路由描述，重点是组件标识、路径前缀与重名去重。 */ () => {
  it('converts a top-level menu with a layout component', /** 顶级带子节点的菜单必须挂到布局组件上。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({
        children: [
          serverMenu({
            component: 'system/user',
            id: 2,
            name: '用户',
            parentId: 1,
            path: 'user',
          }),
        ],
      }),
    ]);

    expect(result[0]).toMatchObject({
      component: 'BasicLayout',
      meta: {
        hideInMenu: false,
        icon: 'user-icon',
        keepAlive: false,
        order: 1,
        title: '用户管理',
      },
      name: '用户管理',
      path: '/system',
    });
    expect(result[0]?.children?.[0]).toMatchObject({
      component: 'system/user',
      name: '用户',
      path: '/system/user',
    });
  });

  it('maps the legacy Layout component name to BasicLayout', /** 旧数据用 Layout，新运行时只认 BasicLayout。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ component: 'Layout', path: 'dashboard' }),
    ]);

    expect(result[0]?.component).toBe('BasicLayout');
  });

  it('clears the component for non-root menus that have children', /** 非顶级菜单自己不需要布局，组件要交给子节点。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({
        children: [
          serverMenu({ id: 2, name: '子', parentId: 1, path: 'child' }),
        ],
        component: 'system',
        id: 1,
        parentId: 9,
        path: 'group',
      }),
    ]);

    expect(result[0]?.component).toBe('');
    expect(result[0]?.path).toBe('/group');
  });

  it('keeps a leaf menu component as provided', /** 叶子菜单必须保留自己的页面标识。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ component: 'system/user', path: 'user' }),
    ]);

    expect(result[0]?.component).toBe('system/user');
  });

  it('treats a missing component as an empty string', /** component 为 null 时不能调用 indexOf。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ component: null, path: 'user' }),
    ]);

    expect(result[0]?.component).toBe('');
  });

  it('splits the query string out of the component into meta', /** 带参数的组件要拆成 component 与 query 两部分。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ component: 'system/user?role=admin&tab=1', path: 'user' }),
    ]);

    expect(result[0]?.component).toBe('system/user');
    expect(result[0]?.meta).toMatchObject({
      query: { role: 'admin', tab: '1' },
    });
  });

  it('marks invisible menus as hidden', /** visible 为 false 的菜单不能出现在导航里。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ path: 'hidden', visible: false }),
    ]);

    expect(result[0]?.meta?.hideInMenu).toBe(true);
  });

  it('uses componentName as the route name when provided', /** 组件名优先，便于前端引用。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ componentName: 'SystemUser', path: 'user' }),
    ]);

    expect(result[0]?.name).toBe('SystemUser');
  });

  it('suffixes the id and warns when a route name repeats', /** 路由名重复会导致安装失败，必须自动去重。 */ () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(/** 不真正打印日志，只让 Spy 记录调用。 */ () => {});

    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ id: 1, name: '重复', path: 'a' }),
      serverMenu({ id: 2, name: '重复', path: 'b' }),
    ]);

    expect(
      result.map(
        /** 只比较路由名，确认去重后缀生效。 */
        (item) => item.name,
      ),
    ).toEqual(['重复', '重复2']);
    expect(error).toHaveBeenCalledWith(
      'menu name duplicate: 重复, id: 2',
      expect.anything(),
    );
  });

  it('converts an external link menu into an iframe route', /** 带 _iframe 参数的外链要内嵌展示，并从地址里去掉该参数。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({
        id: 7,
        name: '外部系统',
        path: 'https://host.com/app?_iframe=1',
      }),
    ]);

    expect(result[0]).toMatchObject({
      component: 'IFrameView',
      meta: {
        iframeSrc: 'https://host.com/app',
        title: '外部系统',
      },
      name: '外部系统',
      path: '7',
    });
  });

  it('keeps a plain external link as a link', /** 没有 _iframe 的外链按新窗口打开处理。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({ id: 8, name: '外部系统', path: 'https://host.com/app' }),
    ]);

    expect(result[0]?.meta).toMatchObject({
      iframeSrc: undefined,
      link: 'https://host.com/app',
    });
  });

  it('prefixes relative child paths with the parent path', /** 子菜单路径要拼成完整路径。 */ () => {
    const result = convertServerMenuToRouteRecordStringComponent([
      serverMenu({
        children: [
          serverMenu({
            component: 'system/user',
            id: 2,
            name: '用户',
            parentId: 1,
            path: 'user',
          }),
        ],
        id: 1,
        parentId: 0,
        path: 'system',
      }),
    ]);

    expect(result[0]?.children?.[0]?.path).toBe('/system/user');
  });

  it('rewrites the source menu in place', /** 转换会就地改写服务端描述，调用方不应复用同一份数据。 */ () => {
    const input = [serverMenu({ component: 'system/user', path: 'user' })];

    convertServerMenuToRouteRecordStringComponent(input);

    expect(input[0]?.path).toBe('/user');
  });

  it('returns an empty array for an empty menu list', /** 没有菜单时不能凭空造出路由。 */ () => {
    expect(convertServerMenuToRouteRecordStringComponent([])).toEqual([]);
  });
});

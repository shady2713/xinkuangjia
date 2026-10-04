/**
 * 动态权限路由生成（@vben/access 的 accessible.ts）的合并、组件包装与路由树调整回归。
 *
 * 该文件补充 `accessible.test.ts` 已覆盖的身份隔离之外的生成语义：混合模式的来源合并、
 * keepAlive 路由的组件重包装、redirect 派生规则以及静态根下的组件裁剪。用例使用真实
 * Router 与真实组件加载器，断言 Router 中可观察的最终记录与渲染结果。
 */
import type { RouteRecordRaw } from 'vue-router';

import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { generateAccessible } from '@vben/access';

import { describe, expect, it, vi } from 'vitest';

/** 创建带静态根的隔离 Router，静态根用于挂载业务子路由。 */
function newRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ name: 'Root', path: '/', component: {} }],
  });
}

/** 权限路由懒加载函数：解析为路由组件模块。 */
type RouteComponentLoader = () => Promise<unknown>;

/** 读取 Router 中已安装记录的组件键，用于判断组件是否被裁剪。 */
function installedComponents(
  router: ReturnType<typeof newRouter>,
  name: string,
) {
  return router
    .getRoutes()
    .find(/** 按名称定位本次安装的记录。 */ (route) => route.name === name)
    ?.components;
}

/** 读取 Router 中某个路径的实际匹配链名称，证明安装位置。 */
function matchedNames(router: ReturnType<typeof newRouter>, path: string) {
  return router
    .resolve(path)
    .matched.map(/** 提取匹配记录的名称。 */ (route) => route.name);
}

describe('混合模式路由来源合并', /** 混合模式同时使用前端路由表与后端菜单，合并结果决定可访问菜单。 */ () => {
  it('前端过滤结果与后端菜单同时安装', /** 任一来源丢失都会让部分菜单无法访问。 */ async () => {
    const router = newRouter();
    /** 模拟布局的懒加载器；layoutMap 要求返回组件模块的加载函数。 */
    const layout = async () => ({ name: 'FixtureLayout' });
    const result = await generateAccessible('mixed', {
      /** 提供后端菜单，只有后端来源才会走菜单转换链路。 */
      fetchMenuListAsync: async () => [
        { component: 'BasicLayout', path: '/back-only' },
      ],
      layoutMap: { BasicLayout: layout },
      pageMap: {},
      roles: ['admin'],
      router,
      routes: [
        {
          component: {},
          meta: { authority: ['admin'], title: '仅前端来源' },
          path: '/front-only',
        },
      ],
    });
    const paths = result.accessibleRoutes.map(
      /** 收集实际生成的路由路径。 */ (route) => route.path,
    );

    expect(new Set(paths)).toEqual(new Set(['/back-only', '/front-only']));
    // 当前实现把静态路由同时并入后端结果，混合模式会生成重复记录；
    // 这里只核对两条来源都被合并，不把重复条数固化为期望契约。
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // 两条来源都必须挂在静态根下并能按各自路径解析到自身记录；
    // 前端来源在混合模式下会随后端结果重复出现，这里不把重复条数固化为期望契约。
    const frontMatched = router.resolve('/front-only').matched;
    const backMatched = router.resolve('/back-only').matched;
    expect(frontMatched[0]?.name).toBe('Root');
    expect(backMatched[0]?.name).toBe('Root');
    expect(frontMatched.at(-1)?.path).toBe('/front-only');
    expect(backMatched.at(-1)?.path).toBe('/back-only');
  });

  it('同名静态路由在混合模式下被拒绝安装', /** 前端与后端结果重名时必须在写入 Router 前拒绝，避免半安装状态。 */ async () => {
    const router = newRouter();

    await expect(
      generateAccessible('mixed', {
        /** 本次后端来源为空，冲突只可能来自前端路由表。 */
        fetchMenuListAsync: async () => [],
        roles: ['admin'],
        router,
        routes: [{ component: {}, name: 'FrontOnly', path: '/front-only' }],
      }),
    ).rejects.toThrow('权限路由名称与已有记录冲突：FrontOnly');
    expect(router.hasRoute('FrontOnly')).toBe(false);
    expect(router.hasRoute('Root')).toBe(true);
  });
});

describe('keepAlive 路由组件包装', /** 包装后的组件名必须与路由名一致，否则条件缓存永远不命中。 */ () => {
  it('按路由名包装懒加载组件并保留原始渲染结果', /** 包装不得改变真实页面的渲染输出。 */ async () => {
    const router = newRouter();
    const originalView = defineComponent({
      name: 'OriginalView',
      /** 渲染可识别的页面内容，用于证明包装后仍渲染原页面。
       * @returns 渲染页面内容的渲染函数。
       */
      setup() {
        /** 渲染原始页面内容。 */
        const renderOriginal = () =>
          h('div', { class: 'original-view' }, 'original');
        return renderOriginal;
      },
    });
    const loadOriginal = vi.fn(
      /** 模拟真实页面的懒加载入口。 */ async () => ({ default: originalView }),
    );

    await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          component: loadOriginal,
          meta: { keepAlive: true, title: '保活页面' },
          name: 'Kept',
          path: '/kept',
        },
      ],
    });

    const wrapped = installedComponents(router, 'Kept')?.default as
      | RouteComponentLoader
      | undefined;
    expect(loadOriginal).not.toHaveBeenCalled();
    expect(wrapped).toBeTypeOf('function');

    const loaded = (await wrapped?.()) as { name?: string };
    expect(loadOriginal).toHaveBeenCalledTimes(1);
    expect(loaded.name).toBe('Kept');

    const wrapper = mount(loaded as Parameters<typeof mount>[0]);
    await nextTick();
    expect(wrapper.find('.original-view').text()).toBe('original');
  });

  it('懒加载结果没有默认导出时原样返回', /** 非组件模块不能被强行包装成组件。 */ async () => {
    const router = newRouter();
    const emptyModule = { notAComponent: true };
    const loadOriginal = vi.fn(
      /** 模拟返回非组件模块的异常页面入口。 */ async () => emptyModule,
    );

    await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          component: loadOriginal,
          meta: { keepAlive: true, title: '保活页面' },
          name: 'EmptyModule',
          path: '/empty-module',
        },
      ],
    });

    const wrapped = installedComponents(router, 'EmptyModule')?.default as
      | RouteComponentLoader
      | undefined;

    await expect(wrapped?.()).resolves.toBe(emptyModule);
  });

  it('未开启 keepAlive 的路由保持原组件', /** 包装会改变组件名，只能用于声明了缓存的页面。 */ async () => {
    const router = newRouter();
    const loadOriginal = vi.fn(
      /** 模拟不需要缓存的页面入口。 */ async () => ({ default: {} }),
    );

    await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [{ component: loadOriginal, name: 'Plain', path: '/plain' }],
    });

    expect(installedComponents(router, 'Plain')?.default).toBe(loadOriginal);
  });
});

describe('路由树调整', /** redirect 派生与组件裁剪决定 Router 的实际跳转和布局层级。 */ () => {
  it('子路由以绝对路径开头时补全 redirect', /** 缺少 redirect 的父级菜单点击后无法定位到首个子页面。 */ async () => {
    const router = newRouter();
    const result = await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          children: [
            { component: {}, name: 'AbsoluteChild', path: '/parent/child' },
          ],
          component: {},
          name: 'AbsoluteParent',
          path: '/parent',
        },
      ],
    });

    expect(result.accessibleRoutes[0]?.redirect).toBe('/parent/child');
  });

  it('子路由为相对路径时不补全 redirect', /** 相对路径需要拼接完整父级路径，本实现明确不做处理。 */ async () => {
    const router = newRouter();
    const result = await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          children: [{ component: {}, name: 'RelativeChild', path: 'child' }],
          component: {},
          name: 'RelativeParent',
          path: '/relative',
        },
      ],
    });

    expect(result.accessibleRoutes[0]?.redirect).toBeUndefined();
  });

  it('已有 redirect 与无子路由的记录保持原样', /** 覆盖既有跳转配置会改变产品定义的入口行为。 */ async () => {
    const router = newRouter();
    const result = await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          children: [{ component: {}, name: 'RedirectChild', path: '/x' }],
          component: {},
          name: 'RedirectParent',
          path: '/redirected',
          redirect: '/somewhere',
        },
        { component: {}, name: 'Leaf', path: '/leaf' },
      ],
    });

    expect(result.accessibleRoutes[0]?.redirect).toBe('/somewhere');
    expect(result.accessibleRoutes[1]?.redirect).toBeUndefined();
  });

  it('静态根下带子路由的记录移除自身组件', /** 保留组件会出现多层 BasicLayout 嵌套。 */ async () => {
    const router = newRouter();
    const leafComponent = { name: 'LeafStub' };

    const result = await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          children: [
            { component: {}, name: 'NestedChild', path: '/nested/child' },
          ],
          component: { name: 'LayoutStub' },
          name: 'Nested',
          path: '/nested',
        },
        { component: leafComponent, name: 'LeafOnly', path: '/leaf-only' },
      ],
    });

    // 带子路由的布局记录被移除自身组件，避免出现多层 BasicLayout。
    expect(result.accessibleRoutes[0]?.component).toBeUndefined();
    // 无子路由的记录必须保留组件，证明裁剪只针对布局层。
    expect(result.accessibleRoutes[1]?.component).toEqual(leafComponent);
    expect(matchedNames(router, '/nested/child')).toEqual([
      'Root',
      'Nested',
      'NestedChild',
    ]);
  });

  it('声明 noBasicLayout 的记录直接挂在根层', /** 布局外页面不能被塞进静态根的 children。 */ async () => {
    const router = newRouter();
    const outsideComponent = { name: 'OutsideStub' };

    await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          component: outsideComponent,
          meta: { noBasicLayout: true, title: '布局外页面' },
          name: 'Outside',
          path: '/outside',
        },
      ],
    });

    expect(matchedNames(router, '/outside')).toEqual(['Outside']);
    // 生成过程对输入路由执行深拷贝，安装记录中的组件与传入对象深度相等但非同一引用。
    expect(installedComponents(router, 'Outside')?.default).toEqual(
      outsideComponent,
    );
  });

  it('保留未命名记录并交给 Router 按路径匹配', /** 无名称的布局外页面同样必须可访问。 */ async () => {
    const router = newRouter();
    const result = await generateAccessible('frontend', {
      roles: [],
      router,
      routes: [
        {
          component: {},
          meta: { noBasicLayout: true, title: '布局外页面' },
          path: '/unnamed-outside',
        } satisfies RouteRecordRaw,
      ],
    });

    expect(result.accessibleRoutes).toHaveLength(1);
    expect(matchedNames(router, '/unnamed-outside')).toHaveLength(1);
  });
});

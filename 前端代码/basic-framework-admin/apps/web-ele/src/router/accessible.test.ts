/** 使用真实 Router 验证动态权限记录随身份完整替换和清理。 */
import { createMemoryHistory, createRouter } from 'vue-router';

import { generateAccessible, resetAccessibleRoutes } from '@vben/access';

/** 使用真实 Router 验证动态路由所有权及身份切换竞争。 */
import { describe, expect, it } from 'vitest';

/** 创建带静态根及静态子路由的隔离 Router。 */
function newRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        name: 'Root',
        path: '/',
        component: {},
        children: [{ name: 'Static', path: '/static', component: {} }],
      },
    ],
  });
}

/** 创建兼容支持工具链的受控 Promise，显式安排请求完成顺序。 */
function deferred<T>() {
  let resolve!: /** 成功释放本例等待的异步结果。 */ (
    value: PromiseLike<T> | T,
  ) => void;
  let reject!: /** 将受控错误传播给本例等待者。 */ (reason?: unknown) => void;
  const promise = new Promise<T>(
    /** 保存仅由本例持有的完成控制器。 */ (accept, fail) => {
      resolve = accept;
      reject = fail;
    },
  );
  return { promise, reject, resolve };
}

describe('动态权限路由身份隔离', /** 集中验证动态权限路由身份隔离的可观察行为。 */ () => {
  it('动态路由不能覆盖静态根记录', /** 拒绝与核心入口重名的权限记录且保持静态根可用。 */ async () => {
    const router = newRouter();
    await expect(
      generateAccessible('frontend', {
        router,
        routes: [{ name: 'Root', path: '/fake-root', component: {} }],
      }),
    ).rejects.toThrow('权限路由名称与已有记录冲突');
    expect(router.hasRoute('Root')).toBe(true);
    expect(
      router
        .resolve('/static')
        .matched.map(
          /** 读取实际匹配链以证明核心根未被覆盖。 */ (route) => route.name,
        ),
    ).toEqual(['Root', 'Static']);
  });
  it('替换身份时移除原路由，保留静态根，退出清理未命名与布局外路由', /** 安排明确的响应顺序并验证：替换身份时移除原路由，保留静态根，退出清理未命名与布局外路由。 */ async () => {
    const router = newRouter();
    await generateAccessible('frontend', {
      router,
      routes: [
        { name: 'A', path: '/a', component: {} },
        {
          path: '/unnamed-a',
          component: {},
          meta: { noBasicLayout: true, title: '布局外页面' },
        },
      ],
    });
    expect(
      router
        .resolve('/a')
        .matched.map(/** 读取实际匹配记录的身份名称。 */ (route) => route.name),
    ).toEqual(['Root', 'A']);
    expect(router.resolve('/unnamed-a').matched).toHaveLength(1);
    await generateAccessible('frontend', {
      router,
      routes: [{ name: 'B', path: '/b', component: {} }],
    });
    expect(router.hasRoute('A')).toBe(false);
    expect(
      router
        .getRoutes()
        .some(
          /** 查找上次身份的布局外路由。 */ (route) =>
            route.path === '/unnamed-a',
        ),
    ).toBe(false);
    expect(router.hasRoute('B')).toBe(true);
    expect(
      router
        .getRoutes()
        .find(
          /** 找到静态根记录核对其子声明未被污染。 */ (route) =>
            route.name === 'Root',
        )
        ?.children.map(
          /** 读取实际匹配记录的身份名称。 */ (route) => route.name,
        ),
    ).toEqual(['Static']);
    resetAccessibleRoutes(router);
    expect(router.hasRoute('B')).toBe(false);
    expect(router.hasRoute('Root')).toBe(true);
    expect(router.hasRoute('Static')).toBe(true);
  });

  it('旧菜单生成晚到时不能安装或移除新身份路由', /** 安排明确的响应顺序并验证：旧菜单生成晚到时不能安装或移除新身份路由。 */ async () => {
    const router = newRouter();
    /** 释放旧身份正在等待的结果。 */
    const response = deferred<[]>();
    let current = true;
    const old = generateAccessible('backend', {
      router,
      routes: [],
      /** 返回本例受控身份是否有效。 */ /** 写入前读取受控会话状态。 */ isCurrent:
        () => current,
      /** 延迟旧身份菜单到新身份安装之后。 */ fetchMenuListAsync: () =>
        response.promise,
    });
    current = false;
    await generateAccessible('frontend', {
      router,
      routes: [{ name: 'B', path: '/b', component: {} }],
    });
    response.resolve([]);
    expect(await old).toEqual({ accessibleMenus: [], accessibleRoutes: [] });
    expect(router.hasRoute('B')).toBe(true);
  });
});

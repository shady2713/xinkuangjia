/** 概览与个人中心静态路由测试：验证路由元信息契约，并确认懒加载组件指向真实存在的页面。
 *
 * 页面模块的首次编译与求值放在模块作用域完成，属于测试初始化成本，不计入用例预算。
 *
 * 本文件刻意放在 `__tests__/` 而不是被测源码同目录：`routes/index.ts` 用 eager 的
 * `import.meta.glob` 收集 `modules` 目录下的全部 TS 文件，测试文件若落在该目录下
 * 会被打进生产产物（实测曾把 vitest 一并打包）。
 */
import { describe, expect, it } from 'vitest';

import routes from '../modules/dashboard';

/** 懒加载组件类型：调用后返回含默认导出的页面模块。 */
type LazyComponent = () => Promise<{ default: unknown }>;

/** 取出指定路径的静态路由定义，缺失时直接失败而不是让断言读到 undefined。
 * @param path 路由路径。
 * @returns 对应路由定义。
 * @throws {Error} 目标路径不在本模块导出的静态路由中。
 */
function routeOf(path: string) {
  const route = routes.find(
    /** 按路径匹配目标路由。 */ (item) => item.path === path,
  );
  if (!route) throw new Error(`缺少路由定义: ${path}`);
  return route;
}

/** 把路由组件按懒加载函数调用。
 * @param path 路由路径。
 * @returns 页面模块的默认导出。
 * @throws {Error} 路由没有配置函数式懒加载组件。
 */
async function loadComponent(path: string) {
  const component = routeOf(path).component as LazyComponent | undefined;
  if (typeof component !== 'function') {
    throw new TypeError(`路由 ${path} 未配置懒加载组件`);
  }
  const module = await component();
  return module.default;
}

// 页面模块在导入期读取运行时配置，必须在首次解析之前提供与 app.config.js 同形状的
// 测试值；这里在模块作用域赋值，既早于下面的首次解析，也早于任何用例钩子。测试文件
// 各自隔离运行环境，因此该替身不会影响其他文件。
(
  globalThis as unknown as { _VBEN_ADMIN_PRO_APP_CONF_: unknown }
)._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_APP_CAPTCHA_ENABLE: 'false',
  VITE_APP_STORE_SECURE_KEY: 'test-store-key',
  VITE_GLOB_API_URL: 'https://example.test/admin-api',
};

// 首次解析会编译并求值概览页与个人中心的页面模块，属于测试初始化成本；在模块作用域
// 完成，避免把它计入用例的 5000ms 预算。用例仍调用真实懒加载组件并断言解析结果。
await loadComponent('/dashboard');
await loadComponent('/profile');

describe('dashboard 静态路由', /** 概览、个人中心与地址重定向是菜单外的基础入口，契约变化会直接影响登录后的首屏。 */ () => {
  it('分析页与个人中心都指向真实存在的页面组件', /** 懒加载路径写错时只会在运行时 404，必须在单元测试里真实导入验证。 */ async () => {
    await expect(loadComponent('/dashboard')).resolves.toBeDefined();
    await expect(loadComponent('/profile')).resolves.toBeDefined();
  });

  it('个人中心与概览页分别声明独立名称与路径', /** 路由名是 keep-alive 与菜单高亮的依据，不能互相覆盖。 */ () => {
    expect(routeOf('/dashboard').name).toBe('Dashboard');
    expect(routeOf('/profile').name).toBe('Profile');
    expect(routeOf('/analytics').redirect).toBe('/dashboard');
  });

  it('概览页固定在标签栏且菜单隐藏规则保持原状', /** affixTab 决定概览页不可关闭，hideInMenu 决定其不出现在菜单里。 */ () => {
    expect(routeOf('/dashboard').meta?.affixTab).toBe(true);
    expect(routeOf('/dashboard').meta?.order).toBe(-1);
    expect(routeOf('/profile').meta?.hideInMenu).toBe(true);
    expect(routeOf('/analytics').meta?.hideInMenu).toBe(true);
  });
});

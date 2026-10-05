/** 应用布局懒加载入口测试：验证三个导出都能解析到真实组件定义，避免路由异步组件在运行时才失败。
 *
 * 布局包模块图的首次编译与求值放在模块作用域完成，属于测试初始化成本，不计入用例预算；
 * 用例只断言真实懒加载函数的解析结果。
 */
import { describe, expect, it } from 'vitest';

import { AuthPageLayout, BasicLayout, IFrameView } from './index';

/** 布局入口使用的懒加载函数签名：调用后返回页面模块。 */
type LayoutLoader = () => Promise<unknown>;

/** 判定解析结果是否已经是 Vue 组件定义。
 * @param value 未知的模块导出。
 * @returns 含渲染函数或 setup 时为 true。
 */
function isComponent(value: unknown): value is { setup?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('render' in value || 'setup' in value)
  );
}

/** 解析异步组件并返回其组件定义。
 * @param loader 路由使用的懒加载函数。
 * @returns 已解析的组件定义。
 * @throws {TypeError} 解析结果不是组件定义时抛出，避免断言读到 undefined。
 */
async function resolveComponent(loader: LayoutLoader) {
  const module = (await loader()) as { default?: unknown };
  const component = module.default ?? module;
  if (!isComponent(component)) {
    throw new TypeError('懒加载结果不是 Vue 组件');
  }
  return component;
}

// 布局在导入期读取运行时配置，必须在首次解析之前提供与 app.config.js 同形状的测试值；
// 这里在模块作用域赋值，既早于下面的首次解析，也早于任何用例钩子。测试文件各自隔离
// 运行环境，因此该替身不会影响其他文件。
(
  globalThis as unknown as { _VBEN_ADMIN_PRO_APP_CONF_: unknown }
)._VBEN_ADMIN_PRO_APP_CONF_ = {
  VITE_APP_CAPTCHA_ENABLE: 'false',
  VITE_APP_STORE_SECURE_KEY: 'test-store-key',
  VITE_GLOB_API_URL: 'https://example.test/admin-api',
  VITE_GLOB_AUTH_DINGDING_CLIENT_ID: '',
  VITE_GLOB_AUTH_DINGDING_CORP_ID: '',
};

// 首次解析布局会编译并求值整套布局包模块图，属于测试初始化成本；在模块作用域完成，
// 避免把它计入用例的 5000ms 预算（此前靠单例 30 秒超时掩盖）。用例仍调用真实懒加载
// 函数并断言解析结果，只是命中已完成的模块缓存。
await resolveComponent(BasicLayout);
await resolveComponent(AuthPageLayout);
await resolveComponent(IFrameView);

describe('应用布局懒加载入口', /** 路由异步组件依赖这些导出，路径或导出名写错只会在真实跳转时暴露。 */ () => {
  it('基础布局与认证页布局都能解析到真实组件', /** 两个布局分别是登录前后的页面外壳，必须能异步加载成功。 */ async () => {
    await expect(resolveComponent(BasicLayout)).resolves.toBeDefined();
    await expect(resolveComponent(AuthPageLayout)).resolves.toBeDefined();
  });

  it('内嵌页视图来自布局包的具名导出', /** 内嵌页取的是 @vben/layouts 的 IFrameView，导出名变化会直接破坏菜单跳转。 */ async () => {
    await expect(resolveComponent(IFrameView)).resolves.toBeDefined();
  });

  it('三个布局导出都是可被路由调用的独立懒加载函数', /** 入口必须保持函数形态交给 vue-router 异步解析，不能提前实例化成同一个组件。 */ () => {
    expect(BasicLayout).toBeTypeOf('function');
    expect(AuthPageLayout).toBeTypeOf('function');
    expect(IFrameView).toBeTypeOf('function');
    expect(BasicLayout).not.toBe(IFrameView);
  });
});

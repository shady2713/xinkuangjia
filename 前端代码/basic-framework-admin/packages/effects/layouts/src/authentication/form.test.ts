/**
 * 认证页外壳（authentication/form.vue）路由视图、页面缓存与插槽渲染回归。
 *
 * 该外壳承载认证页的内容区、路由视图、页面缓存与底部版权插槽：RouterView 未接线会让登录、注册
 * 页面无法切换；KeepAlive 白名单或 key 写错会让表单在切换后丢失已填内容或反复重挂载；插槽丢失会
 * 让品牌区与版权声明不显示。用例在真实内存路由上挂载真实组件，用真实路由跳转与真实 DOM 断言。
 */
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { beforeEach, describe, expect, it } from 'vitest';

import AuthenticationForm from './form.vue';

/** 各认证视图的真实挂载次数，用来判断 KeepAlive 是否命中缓存。 */
const mountCounts = { login: 0, register: 0 };

/**
 * 登录视图：单字组件名与外壳 KeepAlive 的 include 白名单严格一致，才可能被缓存，
 * 因此这里用真实选项对象而不是多字命名的组件封装。
 */
const LoginView = {
  name: 'Login',
  /**
   * 记录真实挂载次数并渲染可定位节点。
   * @returns 渲染登录页占位内容的渲染函数。
   */
  setup() {
    mountCounts.login += 1;
    return /** 渲染登录页占位内容。 */ () =>
      h('div', { 'data-test': 'login-view' }, 'DUMMY-登录表单');
  },
};

/** 注册视图：不在 KeepAlive 白名单内，用来验证白名单过滤真的生效。 */
const RegisterView = {
  name: 'Register',
  /**
   * 记录真实挂载次数并渲染可定位节点。
   * @returns 渲染注册页占位内容的渲染函数。
   */
  setup() {
    mountCounts.register += 1;
    return /** 渲染注册页占位内容。 */ () =>
      h('div', { 'data-test': 'register-view' }, 'DUMMY-注册表单');
  },
};

/**
 * 创建含登录与注册页的真实内存路由，并真实导航到指定地址。
 * @param path 初始导航到的认证页地址。
 * @returns 已完成就绪导航的真实 router 实例。
 */
async function createRouterAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: LoginView, name: 'login', path: '/auth/login' },
      { component: RegisterView, name: 'register', path: '/auth/register' },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

beforeEach(
  /** 重置真实挂载计数，避免用例之间互相影响。 */ () => {
    mountCounts.login = 0;
    mountCounts.register = 0;
  },
);

describe('认证页外壳', /** 路由视图或插槽装配错误会直接影响登录注册入口的可用性。 */ () => {
  it('渲染匹配的路由视图并透传归属侧与插槽', /** 路由视图不渲染会让认证页空白，插槽丢失会让品牌与版权消失。 */ async () => {
    const router = await createRouterAt('/auth/login');
    const wrapper = mount(AuthenticationForm, {
      global: { plugins: [router] },
      props: { dataSide: 'left' },
      slots: {
        copyright: '<span data-test="copyright">DUMMY-版权信息</span>',
        default: '<div data-test="brand">DUMMY-品牌区</div>',
      },
    });

    const login = wrapper.get('[data-test="login-view"]');
    expect(login.text()).toBe('DUMMY-登录表单');
    // dataSide 决定认证页内容相对插画的位置，必须原样落到路由视图根节点。
    expect(login.attributes('data-side')).toBe('left');
    expect(wrapper.get('[data-test="brand"]').text()).toBe('DUMMY-品牌区');
    expect(wrapper.get('[data-test="copyright"]').text()).toBe(
      'DUMMY-版权信息',
    );
    expect(mountCounts.login).toBe(1);
  });

  it('路由切换后渲染新的认证页视图', /** 只渲染首个视图会让用户无法从登录页进入注册页。 */ async () => {
    const router = await createRouterAt('/auth/login');
    const wrapper = mount(AuthenticationForm, {
      global: { plugins: [router] },
    });

    expect(wrapper.find('[data-test="login-view"]').exists()).toBe(true);

    await router.push('/auth/register');

    expect(wrapper.find('[data-test="register-view"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="login-view"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('只缓存白名单内的认证页并保留其已填内容', /** 白名单或 key 写错会让表单在来回切换时丢失用户已填内容或反复重挂载。 */ async () => {
    const router = await createRouterAt('/auth/login');
    const wrapper = mount(AuthenticationForm, {
      global: { plugins: [router] },
    });

    await router.push('/auth/register');
    await router.push('/auth/login');

    // 登录页被 KeepAlive 缓存：回到该页不应产生第二次真实挂载。
    expect(mountCounts.login).toBe(1);
    expect(wrapper.find('[data-test="login-view"]').exists()).toBe(true);
    // 注册页不在白名单：每次进入都重新挂载，不会保留上一次的页面状态。
    await router.push('/auth/register');
    expect(mountCounts.register).toBe(2);
    wrapper.unmount();
  });

  it('不同查询参数被视为不同的认证页实例', /** key 取自 fullPath，忽略查询参数会让带重定向参数的页面复用旧表单。 */ async () => {
    const router = await createRouterAt('/auth/login');
    const wrapper = mount(AuthenticationForm, {
      global: { plugins: [router] },
    });
    expect(mountCounts.login).toBe(1);

    await router.push({
      path: '/auth/login',
      query: { redirect: '/dashboard' },
    });

    expect(router.currentRoute.value.fullPath).toBe(
      '/auth/login?redirect=/dashboard',
    );
    expect(mountCounts.login).toBe(2);
    wrapper.unmount();
  });
});

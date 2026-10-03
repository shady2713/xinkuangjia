/** 旧注册地址应提供可操作的返回入口，并且不再暴露注册表单。 */
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { expect, it } from 'vitest';

import Register from './register.vue';

it('直接访问旧注册地址可以返回普通登录', /** 挂载真实页面并点击实际 RouterLink 验证导航。 */ async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { name: 'Register', path: '/auth/register', component: Register },
      { name: 'Login', path: '/auth/login', component: {} },
    ],
  });
  await router.push('/auth/register');
  const wrapper = mount(Register, { global: { plugins: [router] } });
  try {
    expect(wrapper.get('h1').text()).toBe('暂未开放注册');
    expect(wrapper.find('input').exists()).toBe(false);
    await wrapper.get('a').trigger('click');
    await router.isReady();
    await expect
      .poll(
        /** 观察真实 Router 结束的目标，不依赖点击回调自身报告。 */ () =>
          router.currentRoute.value.path,
      )
      .toBe('/auth/login');
  } finally {
    wrapper.unmount();
    router.options.history.destroy();
  }
});

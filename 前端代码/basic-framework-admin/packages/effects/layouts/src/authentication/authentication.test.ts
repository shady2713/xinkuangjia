/**
 * 认证页外壳（authentication/authentication.vue）面板布局、Logo 与版权插槽回归。
 *
 * 该外壳统一承载登录、注册、忘记密码等认证页，三件事完全由偏好设置驱动：验证区域落在左/中/右
 * 哪一种面板、Logo 是否按明暗模式换成深色版本、版权声明是否渲染。布局判断写错会让表单跑到插画
 * 背后或彻底不渲染；Logo 取值漏掉深色版本会让暗色主题下出现看不见的图标；版权插槽接错会让备案
 * 信息无法展示，也无法被业务方替换。用例挂载真实外壳、真实认证表单容器与真实路由，
 * 用真实偏好设置写入驱动三种布局与明暗模式。
 */
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import {
  preferences,
  resetPreferences,
  updatePreferences,
} from '@vben/preferences';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Authentication from './authentication.vue';
import SloganIcon from './icons/slogan.vue';

/** 登录页占位文案，用于确认认证表单容器真的渲染了路由视图。 */
const LOGIN_TEXT = 'DUMMY-登录表单';

/**
 * 创建承载认证页的最小真实路由。
 * @returns 已完成就绪导航的真实 router 实例。
 */
async function createAuthRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        component: defineComponent({
          name: 'LoginRouteView',
          /**
           * 渲染可定位的登录页占位内容。
           * @returns 渲染函数。
           */
          setup() {
            return /** 渲染登录页占位节点。 */ () =>
              h('div', { 'data-test': 'login-view' }, LOGIN_TEXT);
          },
        }),
        name: 'login',
        path: '/auth/login',
      },
    ],
  });
  await router.push('/auth/login');
  await router.isReady();
  return router;
}

/**
 * 挂载认证页外壳并等待真实路由视图渲染完成。
 * @param props 外壳属性，用于驱动 Logo、标题与插槽开关。
 * @param props.appName 应用名，渲染在 Logo 右侧。
 * @param props.clickLogo Logo 点击回调。
 * @param props.copyright 是否渲染版权插槽。
 * @param props.logo 亮色 Logo 地址。
 * @param props.logoDark 暗色 Logo 地址。
 * @param props.pageTitle 系统口号区标题。
 * @param props.sloganImage 系统口号区自定义图片。
 * @param slots 外部插槽，用于覆盖默认 Logo 与版权内容。
 * @param slots.copyright 版权插槽内容。
 * @param slots.logo Logo 插槽内容。
 * @returns 已挂载的认证页外壳包装器。
 */
async function mountAuthentication(
  props: Record<string, unknown> = {},
  slots: Record<string, string> = {},
) {
  const router = await createAuthRouter();
  return mount(Authentication, {
    global: { plugins: [router] },
    props,
    slots,
  });
}

beforeEach(
  /** 恢复默认偏好设置，避免上一个用例的布局与主题影响下一个。 */ () => {
    resetPreferences();
  },
);

afterEach(
  /** 用例结束后恢复默认偏好设置，避免污染其他测试文件。 */ () => {
    resetPreferences();
  },
);

describe('认证页外壳面板布局', /** 布局判断错误会让表单出现在错误位置甚至完全不渲染。 */ () => {
  it('右侧面板布局把表单容器标记为 right 并展示系统口号', /** 右侧布局是默认配置，标错会让登录表单与右侧插画位置互换。 */ async () => {
    const wrapper = await mountAuthentication({
      appName: 'DUMMY-管理后台',
      logo: 'https://example.com/DUMMY-logo.png',
      pageTitle: 'DUMMY-系统口号',
    });

    const login = wrapper.get('[data-test="login-view"]');
    expect(login.text()).toBe(LOGIN_TEXT);
    expect(login.attributes('data-side')).toBe('right');
    // 右侧面板下口号区带 -enter-x 入场方向，并且渲染真实 SloganIcon。
    expect(wrapper.findComponent(SloganIcon).exists()).toBe(true);
    expect(wrapper.text()).toContain('DUMMY-系统口号');
    expect(wrapper.find(String.raw`.\-enter-x`).exists()).toBe(true);
    wrapper.unmount();
  });

  it('左侧面板布局把表单容器标记为 left 并使用相反入场方向', /** 左侧布局标错会让表单与插画重叠，入场动画方向也会反。 */ async () => {
    updatePreferences({ app: { authPageLayout: 'panel-left' } });
    const wrapper = await mountAuthentication({ appName: 'DUMMY-管理后台' });

    expect(
      wrapper.get('[data-test="login-view"]').attributes('data-side'),
    ).toBe('left');
    expect(wrapper.find('.enter-x').exists()).toBe(true);
    expect(wrapper.find(String.raw`.\-enter-x`).exists()).toBe(false);
    wrapper.unmount();
  });

  it('中间面板布局只渲染居中表单容器且不渲染系统口号区', /** 居中布局下仍渲染口号区会让表单被插画挤走，用户看不到登录入口。 */ async () => {
    updatePreferences({ app: { authPageLayout: 'panel-center' } });
    const wrapper = await mountAuthentication({ pageTitle: 'DUMMY-系统口号' });

    // 居中布局的认证容器使用 bottom 归属侧，且不渲染口号区块。
    expect(
      wrapper.get('[data-test="login-view"]').attributes('data-side'),
    ).toBe('bottom');
    expect(wrapper.findComponent(SloganIcon).exists()).toBe(false);
    expect(wrapper.find('.enter-x').exists()).toBe(false);
    wrapper.unmount();
  });

  it('提供系统口号图片时用图片替换默认插画', /** 自定义口号图未生效会让业务方无法替换默认品牌插画。 */ async () => {
    const wrapper = await mountAuthentication({
      appName: 'DUMMY-管理后台',
      sloganImage: 'https://example.com/DUMMY-slogan.png',
    });

    expect(wrapper.findComponent(SloganIcon).exists()).toBe(false);
    const image = wrapper.get(
      'img[src="https://example.com/DUMMY-slogan.png"]',
    );
    expect(image.attributes('alt')).toBe('DUMMY-管理后台');
    wrapper.unmount();
  });
});

describe('认证页外壳 Logo 区域', /** Logo 取值与点击契约错误会让品牌区不可见或点不动。 */ () => {
  it('暗色模式下使用深色 Logo', /** 暗色主题下继续使用亮色 Logo 会让图标在深色背景上看不见。 */ async () => {
    updatePreferences({ theme: { mode: 'dark' } });
    const wrapper = await mountAuthentication({
      logo: 'https://example.com/DUMMY-logo.png',
      logoDark: 'https://example.com/DUMMY-logo-dark.png',
    });

    expect(wrapper.get('img').attributes('src')).toBe(
      'https://example.com/DUMMY-logo-dark.png',
    );
    wrapper.unmount();
  });

  it('暗色模式但未提供深色 Logo 时回退到默认 Logo', /** 缺少深色版本时若不回退，Logo 会变成空地址而显示破图。 */ async () => {
    updatePreferences({ theme: { mode: 'dark' } });
    const wrapper = await mountAuthentication({
      logo: 'https://example.com/DUMMY-logo.png',
    });

    expect(wrapper.get('img').attributes('src')).toBe(
      'https://example.com/DUMMY-logo.png',
    );
    wrapper.unmount();
  });

  it('亮色模式始终使用默认 Logo', /** 亮色下误用深色 Logo 会让图标在浅色背景上看不清。 */ async () => {
    updatePreferences({ theme: { mode: 'light' } });
    const wrapper = await mountAuthentication({
      logo: 'https://example.com/DUMMY-logo.png',
      logoDark: 'https://example.com/DUMMY-logo-dark.png',
    });

    expect(wrapper.get('img').attributes('src')).toBe(
      'https://example.com/DUMMY-logo.png',
    );
    wrapper.unmount();
  });

  it('点击 Logo 区域触发传入的点击回调', /** 点击契约断开会让业务方无法把 Logo 接到首页跳转。 */ async () => {
    let clicked = 0;
    const wrapper = await mountAuthentication({
      appName: 'DUMMY-管理后台',
      /** 记录真实的 Logo 点击次数。 */
      clickLogo: () => {
        clicked += 1;
      },
    });

    await wrapper.get('.absolute.left-0.top-0.z-10').trigger('click');

    expect(clicked).toBe(1);
    wrapper.unmount();
  });

  it('未提供 Logo 与应用名时不渲染 Logo 区域', /** Logo 与应用名都为空时仍渲染空容器会挡住表单的点击区域。 */ async () => {
    const wrapper = await mountAuthentication();

    expect(wrapper.find('.absolute.left-0.top-0.z-10').exists()).toBe(false);
    wrapper.unmount();
  });

  it('logo 插槽可以整体替换默认 Logo 区域', /** 插槽失效会让业务方无法定制品牌区，只能接受默认 Logo。 */ async () => {
    const wrapper = await mountAuthentication(
      { appName: 'DUMMY-管理后台', logo: 'https://example.com/DUMMY-logo.png' },
      { logo: '<div data-test="custom-logo">DUMMY-自定义品牌区</div>' },
    );

    expect(wrapper.get('[data-test="custom-logo"]').text()).toBe(
      'DUMMY-自定义品牌区',
    );
    expect(wrapper.find('img').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('认证页外壳版权插槽', /** 版权与备案信息是否展示直接影响合规。 */ () => {
  it('默认渲染偏好设置里的版权信息', /** 版权开启时不渲染会让备案信息缺失。 */ async () => {
    updatePreferences({ copyright: { companyName: 'DUMMY-示例公司' } });
    const wrapper = await mountAuthentication();

    expect(preferences.copyright.enable).toBe(true);
    expect(wrapper.text()).toContain('DUMMY-示例公司');
    wrapper.unmount();
  });

  it('关闭版权开关后不渲染版权信息', /** 版权关闭后仍渲染会让关闭开关形同虚设。 */ async () => {
    updatePreferences({
      copyright: { companyName: 'DUMMY-示例公司', enable: false },
    });
    const wrapper = await mountAuthentication();

    expect(wrapper.text()).not.toContain('DUMMY-示例公司');
    wrapper.unmount();
  });

  it('外壳关闭版权插槽时不渲染任何版权内容', /** 外壳级开关失效会让不需要版权的页面被迫展示备案信息。 */ async () => {
    updatePreferences({ copyright: { companyName: 'DUMMY-示例公司' } });
    const wrapper = await mountAuthentication({ copyright: false });

    expect(wrapper.text()).not.toContain('DUMMY-示例公司');
    wrapper.unmount();
  });

  it('外部版权插槽覆盖默认版权内容', /** 插槽失效会让业务方无法用自有版权声明替换默认内容。 */ async () => {
    updatePreferences({ copyright: { companyName: 'DUMMY-示例公司' } });
    const wrapper = await mountAuthentication(
      {},
      { copyright: '<span data-test="custom-copyright">DUMMY-版权声明</span>' },
    );

    expect(wrapper.get('[data-test="custom-copyright"]').text()).toBe(
      'DUMMY-版权声明',
    );
    expect(wrapper.text()).not.toContain('DUMMY-示例公司');
    wrapper.unmount();
  });
});

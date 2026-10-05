/**
 * 二维码登录页（effects/common-ui 的 ui/authentication/qrcode-login）参数与跳转回归。
 *
 * 二维码登录页把扫码地址交给二维码库生成图片：地址或纠错参数写错会让用户扫到无效页面或
 * 在图片破损时无法识别；返回登录按钮失效会让没有手机应用的用户被困在扫码页；
 * 说明文案缺失会让用户不知道扫码后该做什么。二维码图片由外部库生成并依赖浏览器画布能力，
 * 属于外部边界，这里只替换这一个边界并保留真实调用参数与渲染结果，路由跳转仍走真实内存路由。
 */
import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useQRCode } from '@vueuse/integrations/useQRCode';
import { afterEach, describe, expect, it, vi } from 'vitest';

import QrcodeLogin from './qrcode-login.vue';

vi.mock(
  '@vueuse/integrations/useQRCode',
  /** 二维码图片由外部库生成（依赖浏览器画布能力），测试只保留真实调用参数与渲染结果。 */ async () => {
    const { ref } = await import('vue');
    return {
      /** 记录组件传入的扫码地址与纠错参数，并返回固定的图片地址供渲染断言。 */
      useQRCode: vi.fn(
        /** 返回固定的二维码图片地址，避免依赖浏览器画布能力。 */ () =>
          ref('data:image/png;base64,DUMMY-qrcode'),
      ),
    };
  },
);

/** 二维码登录页用例属性：只列出用例真正覆盖的字段，其余走组件默认值。 */
interface QrcodeLoginCaseProps {
  description?: string;
  loading?: boolean;
  loginPath?: string;
  showBack?: boolean;
  subTitle?: string;
  title?: string;
}

/** 占位路由组件：用例只关心跳转结果，目标页面内容不参与断言。 */
const EmptyRoute = {
  /** 占位渲染函数不输出任何内容。 */
  render: () => null,
};

/** 最近一次挂载的二维码登录页，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: undefined | VueWrapper;

afterEach(
  /** 卸载组件并复位替身，避免用例之间互相影响。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.clearAllMocks();
  },
);

/**
 * 建立真实内存路由并挂载二维码登录页。
 * @param props 页面属性，用来覆盖路径、文案与返回按钮。
 * @param slots 调用方传入的插槽内容，用于验证标题、说明与描述定制分支。
 * @returns 真实路由实例与已挂载的组件包装器。
 */
async function mountQrcodeLogin(
  props: QrcodeLoginCaseProps = {},
  slots: Record<string, string> = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: EmptyRoute, path: '/auth/login' },
      { component: EmptyRoute, path: '/auth/qrcode-login' },
      { component: EmptyRoute, path: '/custom/login' },
    ],
  });
  await router.push('/auth/qrcode-login');
  await router.isReady();
  const wrapper = mount(QrcodeLogin, {
    global: { plugins: [router] },
    props,
    slots,
  });
  mounted = wrapper as VueWrapper;
  await flushPromises();
  return { router, wrapper };
}

describe('二维码登录页二维码', /** 扫码地址与纠错参数决定用户能否扫到正确的登录入口。 */ () => {
  it('按内置扫码地址与高纠错参数生成二维码并渲染为图片', /** 参数取错会让二维码在破损或弱光下无法识别。 */ async () => {
    const { wrapper } = await mountQrcodeLogin();

    const forwarded = vi.mocked(useQRCode).mock.calls[0];
    expect(forwarded?.[0]).toMatchObject({ value: 'https://t.zsxq.com/FUtQd' });
    expect(forwarded?.[1]).toEqual({ errorCorrectionLevel: 'H', margin: 4 });
    const image = wrapper.get('img');
    expect(image.attributes('src')).toBe('data:image/png;base64,DUMMY-qrcode');
    expect(image.attributes('alt')).toBe('qrcode');
  });
});

describe('二维码登录页导航与文案', /** 返回入口与说明文案决定用户能否退回密码登录并完成扫码。 */ () => {
  it('点击返回按钮跳转到默认登录路由', /** 返回失效会让没有手机应用的用户被困在扫码页。 */ async () => {
    const { router, wrapper } = await mountQrcodeLogin();

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/auth/login');
  });

  it('返回按钮跳转使用调用方传入的路径', /** 路径写死会让不同应用跳转到本系统不存在的页面。 */ async () => {
    const { router, wrapper } = await mountQrcodeLogin({
      loginPath: '/custom/login',
    });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/custom/login');
  });

  it('关闭返回按钮后不渲染返回入口', /** 配置无效会在纯扫码场景留下多余按钮。 */ async () => {
    const { wrapper } = await mountQrcodeLogin({ showBack: false });

    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('标题、说明与提示文案可由属性覆盖', /** 文案写死会让业务无法说明自己的扫码方式。 */ async () => {
    const { wrapper } = await mountQrcodeLogin({
      description: 'DUMMY-扫码提示',
      subTitle: 'DUMMY-扫码说明',
      title: 'DUMMY-扫码标题',
    });

    expect(wrapper.get('h2').text()).toContain('DUMMY-扫码标题');
    expect(wrapper.findAll('p')[0]?.text()).toContain('DUMMY-扫码说明');
    expect(wrapper.findAll('p').at(-1)?.text()).toContain('DUMMY-扫码提示');
  });

  it('标题、说明与提示插槽覆盖默认文案', /** 插槽失效会让业务无法替换扫码页文案。 */ async () => {
    const { wrapper } = await mountQrcodeLogin(
      {},
      {
        description: '<span data-test="description">DUMMY-插槽提示</span>',
        subTitle: '<span data-test="sub-title">DUMMY-插槽说明</span>',
        title: '<span data-test="title">DUMMY-插槽标题</span>',
      },
    );

    expect(wrapper.get('[data-test="title"]').text()).toBe('DUMMY-插槽标题');
    expect(wrapper.get('[data-test="sub-title"]').text()).toBe(
      'DUMMY-插槽说明',
    );
    expect(wrapper.get('[data-test="description"]').text()).toBe(
      'DUMMY-插槽提示',
    );
  });
});

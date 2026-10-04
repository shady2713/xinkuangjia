/** 校验扫码登录页面包装组件向统一登录视图透传登录路径，避免二维码失效后跳回错误地址。 */
import { mount } from '@vue/test-utils';

import { LOGIN_PATH } from '@vben/constants';

import { describe, expect, it, vi } from 'vitest';

import QrCodeLoginPage from './qrcode-login.vue';

vi.mock(
  '@vben/common-ui',
  /** 扫码登录视图依赖二维码渲染与国际化，这里用最小替身隔离，只验证路径透传。 */ () => ({
    /** 把收到的 login-path 属性渲染成可断言文本，用于确认包装页传值。 */
    AuthenticationQrCodeLogin: {
      name: 'QrCodeLoginStub',
      props: { loginPath: { default: '', type: String } },
      template:
        '<div data-test="qr-code-login" :data-login-path="loginPath" />',
    },
  }),
);

describe('扫码登录页面包装组件', /** 该组件是认证分组下的独立路由目标，注册名与登录路径都属于可观察契约。 */ () => {
  it('注册名固定为 QrCodeLogin', /** 名称用于路由缓存与调试定位，改名会让缓存命中失效。 */ () => {
    expect(QrCodeLoginPage.name).toBe('QrCodeLogin');
  });

  it('把常量中的登录路径传给扫码登录视图', /** 路径必须来自共享常量而不是硬编码，否则认证入口变更后会跳向失效地址。 */ () => {
    const wrapper = mount(QrCodeLoginPage);
    const view = wrapper.find('[data-test="qr-code-login"]');
    expect(view.exists()).toBe(true);
    expect(view.attributes('data-login-path')).toBe(LOGIN_PATH);
    expect(LOGIN_PATH).toBe('/auth/login');
  });
});

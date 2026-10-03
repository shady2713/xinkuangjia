/** 验证默认关闭注册，以及验证码完成晚于身份切换时不能重新登录旧账号。 */
import type { VueWrapper } from '@vue/test-utils';

import { flushPromises, mount } from '@vue/test-utils';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { advanceSession } from '#/utils/auth-session';

import Login from './login.vue';

const boundary = vi.hoisted(
  /** 仅替换组件外部的表单与认证动作，方便控制返回顺序。 */ () => ({
    authLogin: vi.fn(),
    captchaEnabled: true,
    getValues: vi.fn(),
  }),
);

vi.mock(
  '#/store',
  /** 保留真实登录页处理逻辑，认证动作作为可观察边界。 */ () => ({
    /** 返回本例认证边界。 */ useAuthStore: () => ({
      authLogin: boundary.authLogin,
      loginLoading: false,
    }),
  }),
);
vi.mock(
  '@vben/hooks',
  /** 本组专门覆盖启用验证码时的身份竞争。 */ () => ({
    /** 选择本例覆盖的验证码开关。 */ isCaptchaEnable: () =>
      boundary.captchaEnabled,
  }),
);
vi.mock(
  '@vben/locales',
  /** 不依赖语言资源初始化。 */ () => ({
    /** 保留稳定的语言消息键。 */ $t: (key: string) => key,
  }),
);
vi.mock(
  '#/api/core/auth',
  /** 验证码事件由用例控制，不调用真实网络。 */ () => ({
    checkCaptcha: vi.fn(),
    getCaptcha: vi.fn(),
  }),
);
vi.mock(
  '#/adapter/form',
  /** 表单校验由独立契约覆盖，本组只安排 getValues 完成顺序。 */ () => ({
    /** 返回满足表单默认值接口的测试约束。 */ buildLoginPasswordSchema: () => ({
      default: vi.fn(),
    }),
    /** 返回满足表单默认值接口的测试约束。 */ buildRequiredUsernameSchema:
      () => ({ default: vi.fn() }),
  }),
);
vi.mock(
  '@vben/common-ui',
  /** 替换叶子 UI，事件仍由真实页面接收和处理。 */ async () => {
    const { defineComponent, h } = await import('vue');
    /** 为表单与验证码创建遵守相同事件边界的轻量叶子组件。
     * @param name 供测试获取的组件名。
     * @returns 可挂载并暴露表单/弹层边界的测试组件。
     */
    function createLeaf(name: string) {
      return defineComponent({
        name,
        props: { showRegister: { type: Boolean, default: true } },
        emits: ['submit', 'onSuccess'],
        /** 暴露页面需要的表单取值与验证码显示边界。
         * @param _props 本组不渲染表单字段，但保留注册展示属性。
         * @param context Vue 提供的公开实例设置接口。
         * @param context.expose 将表单或验证码入口公开给页面 ref。
         * @returns 叶子节点渲染函数。
         */
        setup(_props, { expose }) {
          expose({
            /** 让页面经过真实 await 取值边界。 */
            getFormApi: () => ({ getValues: boundary.getValues }),
            show: vi.fn(),
          });
          return /** 提供可挂载的叶子节点。 */ () => h('div');
        },
      });
    }
    return {
      AuthenticationLogin: createLeaf('AuthenticationLogin'),
      Verification: createLeaf('VerificationStub'),
    };
  },
);

describe('登录页安全默认与验证码生命周期', /** 验证正常验证码登录与旧页面取消行为。 */ () => {
  let wrapper: VueWrapper;

  beforeEach(
    /** 为每例建立新身份并清空边界调用记录。 */ () => {
      vi.clearAllMocks();
      boundary.captchaEnabled = true;
      advanceSession();
      boundary.getValues.mockResolvedValue({
        username: 'A',
        password: 'test-input',
      });
      wrapper = mount(Login);
    },
  );

  afterEach(
    /** 触发真实卸载清理，避免页面持有生命周期回调。 */ () => wrapper.unmount(),
  );

  it('默认关闭注册展示，当前验证码成功仍可正常登录', /** 通过组件事件验证普通登录链路可用。 */ async () => {
    const form = wrapper.getComponent({ name: 'AuthenticationLogin' });
    expect(form.props('showRegister')).toBe(false);
    form.vm.$emit('submit', { username: 'A', password: 'test-input' });
    wrapper
      .getComponent({ name: 'VerificationStub' })
      .vm.$emit('onSuccess', { captchaVerification: 'test-verification' });
    await flushPromises();
    expect(boundary.authLogin).toHaveBeenCalledWith('username', {
      username: 'A',
      password: 'test-input',
      captchaVerification: 'test-verification',
    });
  });

  it('验证码成功后读取表单期间换身份，不得再登录旧账号', /** 在真实页面 await 边界暂停取值，再切换到另一轮身份。 */ async () => {
    let resolve!: /** 释放旧页面正在读取的表单值。 */ (value: {
      password: string;
      username: string;
    }) => void;
    boundary.getValues.mockImplementationOnce(
      /** 用可控 Promise 暂停表单取值。 */ () =>
        new Promise(
          /** 保存当前测试的完成句柄。 */ (accept) => {
            resolve = accept;
          },
        ),
    );
    wrapper
      .getComponent({ name: 'AuthenticationLogin' })
      .vm.$emit('submit', { username: 'A', password: 'test-input' });
    wrapper
      .getComponent({ name: 'VerificationStub' })
      .vm.$emit('onSuccess', { captchaVerification: 'old-verification' });
    expect(boundary.getValues).toHaveBeenCalledTimes(1);
    advanceSession();
    resolve({ username: 'A', password: 'test-input' });
    await flushPromises();
    expect(boundary.authLogin).not.toHaveBeenCalled();
  });

  it('普通登录只提交实际账号密码字段', /** 关闭验证码时也收窄表单字段，不透传额外授权信息。 */ async () => {
    wrapper.unmount();
    boundary.captchaEnabled = false;
    wrapper = mount(Login);
    wrapper.getComponent({ name: 'AuthenticationLogin' }).vm.$emit('submit', {
      username: 'A',
      password: 'test-input',
      roles: ['unexpected-role'],
    });
    await flushPromises();
    expect(boundary.authLogin).toHaveBeenCalledWith('username', {
      username: 'A',
      password: 'test-input',
    });
  });

  it('非法表单值不能进入验证码完成后的登录动作', /** 表单泛型不能保证运行时值，必须在读取后再次验证。 */ async () => {
    boundary.getValues.mockResolvedValue({ username: 'A', password: {} });
    wrapper.getComponent({ name: 'AuthenticationLogin' }).vm.$emit('submit', {
      username: 'A',
      password: 'test-input',
    });
    wrapper.getComponent({ name: 'VerificationStub' }).vm.$emit('onSuccess', {
      captchaVerification: 'test-verification',
    });
    await flushPromises();
    expect(boundary.authLogin).not.toHaveBeenCalled();
  });

  it('非法验证码事件不能发起登录', /** 第三方组件事件需要携带有效文本凭证才能进入认证。 */ async () => {
    wrapper.getComponent({ name: 'AuthenticationLogin' }).vm.$emit('submit', {
      username: 'A',
      password: 'test-input',
    });
    wrapper
      .getComponent({ name: 'VerificationStub' })
      .vm.$emit('onSuccess', null);
    await flushPromises();
    expect(boundary.getValues).not.toHaveBeenCalled();
    expect(boundary.authLogin).not.toHaveBeenCalled();
  });
});

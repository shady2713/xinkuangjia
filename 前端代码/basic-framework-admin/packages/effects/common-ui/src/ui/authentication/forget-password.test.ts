/**
 * 忘记密码页（effects/common-ui 的 ui/authentication/forget-password）校验与跳转回归。
 *
 * 忘记密码页收集手机号、验证码与新密码：手机号格式校验失效会把非法号码交给重置接口，
 * 密码长度校验失效会让弱密码通过重置，两次密码一致性校验失效会让用户在新密码上写错一位
 * 却毫无提示，之后再也登不进系统；返回登录失效会让用户无法退回登录页。
 * 用例挂载真实组件与真实表单引擎，真实填写输入框、真实点击提交，只把路由跳转当作外部输入。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { z } from '@vben-core/form-ui';

import { afterEach, describe, expect, it, vi } from 'vitest';

import ForgetPassword from './forget-password.vue';

/** 忘记密码页用例属性：只列出用例真正覆盖的字段，其余走组件默认值。 */
interface ForgetPasswordCaseProps {
  formSchema?: VbenFormSchema[];
  loading?: boolean;
  loginPath?: string;
  submitButtonText?: string;
  subTitle?: string;
  title?: string;
}

/** 忘记密码页经 defineExpose 暴露的表单操作实例。 */
interface ExposedFormApi {
  /** 取出真实表单操作实例。 */
  getFormApi: () => ExposedFormValues;
}

/** 暴露实例上用例真正调用的取值契约。 */
interface ExposedFormValues {
  /** 读取当前表单值。 */
  getValues: () => Promise<unknown>;
}

/** 占位路由组件：用例只关心跳转结果，目标页面内容不参与断言。 */
const EmptyRoute = {
  /** 占位渲染函数不输出任何内容。 */
  render: () => null,
};

/** 最近一次挂载的忘记密码页，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: undefined | VueWrapper;

afterEach(
  /** 卸载组件并复位替身，避免用例之间互相影响。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
  },
);

/**
 * 构造忘记密码表单约束：手机号 11 位、验证码 4 位、新密码至少 8 位且两次输入一致。
 * 确认密码采用生产同一套联动写法：新密码变化时重算规则并在提交时比对两次输入。
 * @returns 忘记密码页表单项列表。
 */
function forgetPasswordSchema(): VbenFormSchema[] {
  return [
    {
      component: 'VbenInput',
      componentProps: { placeholder: '请输入手机号' },
      fieldName: 'mobile',
      label: '手机号',
      rules: z
        .string()
        .min(1, { message: '请输入手机号' })
        .regex(/^\d{11}$/, { message: '请输入 11 位手机号' }),
    },
    {
      component: 'VbenInput',
      componentProps: { placeholder: '请输入验证码' },
      fieldName: 'code',
      label: '验证码',
      rules: z.string().regex(/^\d{4}$/, { message: '请输入 4 位验证码' }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: { placeholder: '请输入新密码' },
      fieldName: 'password',
      label: '新密码',
      rules: z.string().min(8, { message: '密码至少 8 位' }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: { placeholder: '请再次输入新密码' },
      dependencies: {
        /**
         * 确认密码随新密码变化重算，只有与新密码完全一致才通过。
         * @param values 当前表单值，其中 password 是新密码。
         * @returns 比对两次输入是否一致的校验链。
         */
        rules(values) {
          return z
            .string()
            .min(1, { message: '请再次输入新密码' })
            .refine(
              /** 两次输入必须完全相同。 */ (value) =>
                value === values.password,
              { message: '两次输入的密码不一致' },
            );
        },
        triggerFields: ['password'],
      },
      fieldName: 'confirmPassword',
      label: '确认密码',
    },
  ];
}

/**
 * 建立真实内存路由并挂载忘记密码页。
 * @param props 页面属性，用来覆盖路径、文案与加载态。
 * @returns 真实路由实例与已挂载的组件包装器。
 */
async function mountForgetPassword(props: ForgetPasswordCaseProps = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: EmptyRoute, path: '/auth/forget-password' },
      { component: EmptyRoute, path: '/auth/login' },
      { component: EmptyRoute, path: '/custom/login' },
    ],
  });
  await router.push('/auth/forget-password');
  await router.isReady();
  const wrapper = mount(ForgetPassword, {
    global: { plugins: [router] },
    props: { formSchema: forgetPasswordSchema(), ...props },
  });
  mounted = wrapper as VueWrapper;
  await flushPromises();
  return { router, wrapper };
}

/**
 * 真实填写手机号、验证码与新密码，并等待确认密码的联动规则按新密码重算。
 * @param wrapper 已挂载的页面包装器。
 * @param values 三个基础字段的填写内容。
 */
async function fillBaseFields(
  wrapper: VueWrapper,
  values: { code: string; mobile: string; password: string },
) {
  await wrapper.get('input[name="mobile"]').setValue(values.mobile);
  await wrapper.get('input[name="code"]').setValue(values.code);
  await wrapper.get('input[name="password"]').setValue(values.password);
  await flushPromises();
}

/**
 * 真实点击提交按钮并等待异步校验与提交结束。
 * @param wrapper 已挂载的页面包装器。
 */
async function clickSubmit(wrapper: VueWrapper) {
  await wrapper.get('button[aria-label="submit"]').trigger('click');
  await flushPromises();
}

describe('忘记密码页表单校验', /** 校验决定非法手机号与弱密码能否进入重置请求。 */ () => {
  it('必填未填时不提交并展示必填提示', /** 未校验就提交会让重置接口收到空手机号。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默表单校验失败日志，用例只断言它真实发生过。 */ () => {},
      );
    const { wrapper } = await mountForgetPassword();

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    expect(wrapper.text()).toContain('请输入手机号');
  });

  it('新密码长度不足时不提交并展示长度提示', /** 长度校验失效会让弱密码通过重置。 */ async () => {
    const { wrapper } = await mountForgetPassword();
    await fillBaseFields(wrapper, {
      code: '1234',
      mobile: '13800000000',
      password: 'DUMMY-p',
    });
    await wrapper.get('input[name="confirmPassword"]').setValue('DUMMY-p');

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('密码至少 8 位');
  });

  it('两次密码不一致时不提交并展示一致性提示', /** 一致性校验失效会让用户在新密码上写错却毫无提示。 */ async () => {
    const { wrapper } = await mountForgetPassword();
    await fillBaseFields(wrapper, {
      code: '1234',
      mobile: '13800000000',
      password: 'DUMMY-pass1',
    });
    await wrapper.get('input[name="confirmPassword"]').setValue('DUMMY-pass2');

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('两次输入的密码不一致');
  });

  it('全部字段合法时提交整表载荷', /** 少传字段会让后端拿不到重置密码所需的信息。 */ async () => {
    const { wrapper } = await mountForgetPassword();
    await fillBaseFields(wrapper, {
      code: '1234',
      mobile: '13800000000',
      password: 'DUMMY-pass1',
    });
    await wrapper.get('input[name="confirmPassword"]').setValue('DUMMY-pass1');

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      code: '1234',
      confirmPassword: 'DUMMY-pass1',
      mobile: '13800000000',
      password: 'DUMMY-pass1',
    });
  });
});

describe('忘记密码页导航与展示', /** 导航与展示决定用户能否退回登录页并确认当前页面。 */ () => {
  it('点击返回按钮跳转到默认登录路由', /** 返回失效会让用户重置完密码后不知道从哪里登录。 */ async () => {
    const { router, wrapper } = await mountForgetPassword();

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/auth/login');
  });

  it('返回按钮跳转使用调用方传入的路径', /** 路径写死会让不同应用跳转到本系统不存在的页面。 */ async () => {
    const { router, wrapper } = await mountForgetPassword({
      loginPath: '/custom/login',
    });

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/custom/login');
  });

  it('加载态在按钮上呈现等待样式', /** 未置加载态会让用户重复点击并重复发送重置请求。 */ async () => {
    const { wrapper } = await mountForgetPassword({ loading: true });

    expect(wrapper.get('button[aria-label="submit"]').classes()).toContain(
      'cursor-wait',
    );
  });

  it('标题、说明与提交按钮文案可由属性覆盖', /** 文案写死会让业务无法按自己的流程提示用户。 */ async () => {
    const { wrapper } = await mountForgetPassword({
      submitButtonText: 'DUMMY-重置按钮',
      subTitle: 'DUMMY-重置说明',
      title: 'DUMMY-重置标题',
    });

    expect(wrapper.text()).toContain('DUMMY-重置标题');
    expect(wrapper.text()).toContain('DUMMY-重置说明');
    expect(wrapper.get('button[aria-label="submit"]').text()).toBe(
      'DUMMY-重置按钮',
    );
  });

  it('向调用方暴露真实表单操作实例', /** 父组件拿不到表单实例就无法在重置成功后重置表单。 */ async () => {
    const { wrapper } = await mountForgetPassword();
    await fillBaseFields(wrapper, {
      code: '1234',
      mobile: '13800000000',
      password: 'DUMMY-pass1',
    });

    const exposed = (wrapper.vm as unknown as ExposedFormApi).getFormApi();

    await expect(exposed.getValues()).resolves.toEqual({
      code: '1234',
      mobile: '13800000000',
      password: 'DUMMY-pass1',
    });
  });
});

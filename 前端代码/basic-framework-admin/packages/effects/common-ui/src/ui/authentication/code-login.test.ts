/**
 * 手机验证码登录页（effects/common-ui 的 ui/authentication/code-login）校验与跳转回归。
 *
 * 验证码登录页负责收集手机号与短信验证码：手机号格式校验失效会把非法号码交给短信接口，
 * 验证码位数校验失效会让错误验证码进入登录请求；返回登录按钮失效会让用户被卡在本页面，
 * 加载态缺失会让用户重复点击造成重复发送短信。用例挂载真实组件与真实表单引擎，
 * 真实填写输入框、真实点击提交，只把路由跳转与表单约束当作真实外部输入。
 */
import type { VueWrapper } from '@vue/test-utils';

import type { VbenFormSchema } from '@vben-core/form-ui';

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

import { z } from '@vben-core/form-ui';

import { afterEach, describe, expect, it, vi } from 'vitest';

import CodeLogin from './code-login.vue';

/** 验证码登录页用例属性：只列出用例真正覆盖的字段，其余走组件默认值。 */
interface CodeLoginCaseProps {
  formSchema?: VbenFormSchema[];
  loading?: boolean;
  loginPath?: string;
  showBack?: boolean;
  submitButtonText?: string;
  subTitle?: string;
  title?: string;
}

/** 验证码登录页经 defineExpose 暴露的表单操作实例。 */
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

/** 最近一次挂载的验证码登录页，用例结束后统一卸载，避免残留污染后续用例。 */
let mounted: undefined | VueWrapper;

afterEach(
  /** 卸载组件并复位替身，避免用例之间互相影响。 */ () => {
    mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
  },
);

/**
 * 构造验证码登录表单约束：手机号为 11 位数字，验证码为 4 位数字。
 * 生产环境由应用适配器提供同一份约束，这里保持真实校验链路而不是直接给结果。
 * @returns 验证码登录页表单项列表。
 */
function codeLoginSchema(): VbenFormSchema[] {
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
  ];
}

/**
 * 建立真实内存路由并挂载验证码登录页。
 * @param props 页面属性，用来覆盖路径、文案、返回按钮与加载态。
 * @param slots 调用方传入的插槽内容，用于验证标题与说明的定制分支。
 * @returns 真实路由实例与已挂载的组件包装器。
 */
async function mountCodeLogin(
  props: CodeLoginCaseProps = {},
  slots: Record<string, string> = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { component: EmptyRoute, path: '/auth/code-login' },
      { component: EmptyRoute, path: '/auth/login' },
      { component: EmptyRoute, path: '/custom/login' },
    ],
  });
  await router.push('/auth/code-login');
  await router.isReady();
  const wrapper = mount(CodeLogin, {
    global: { plugins: [router] },
    props: { formSchema: codeLoginSchema(), ...props },
    slots,
  });
  mounted = wrapper as VueWrapper;
  await flushPromises();
  return { router, wrapper };
}

/**
 * 真实填写手机号与验证码输入框。
 * @param wrapper 已挂载的页面包装器。
 * @param values 手机号与验证码的填写内容。
 */
async function fillCodeForm(
  wrapper: VueWrapper,
  values: { code: string; mobile: string },
) {
  await wrapper.get('input[name="mobile"]').setValue(values.mobile);
  await wrapper.get('input[name="code"]').setValue(values.code);
}

/**
 * 真实点击提交按钮并等待异步校验与提交结束。
 * @param wrapper 已挂载的页面包装器。
 */
async function clickSubmit(wrapper: VueWrapper) {
  await wrapper.findAll('button')[0]?.trigger('click');
  await flushPromises();
}

describe('验证码登录页表单校验', /** 校验决定非法手机号与错误验证码能否进入登录请求。 */ () => {
  it('手机号未填时不提交并展示必填提示', /** 空手机号提交会浪费一次短信请求并让用户看不到原因。 */ async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(
        /** 静默表单校验失败日志，用例只断言它真实发生过。 */ () => {},
      );
    const { wrapper } = await mountCodeLogin();

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    expect(wrapper.text()).toContain('请输入手机号');
  });

  it('手机号位数不足时不提交并展示格式提示', /** 格式校验失效会把非法号码交给短信接口。 */ async () => {
    const { wrapper } = await mountCodeLogin();
    await fillCodeForm(wrapper, { code: '1234', mobile: '1380000000' });

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('请输入 11 位手机号');
  });

  it('验证码位数不足时不提交并展示格式提示', /** 位数校验失效会让明显错误的验证码进入登录请求。 */ async () => {
    const { wrapper } = await mountCodeLogin();
    await fillCodeForm(wrapper, { code: '12', mobile: '13800000000' });

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.text()).toContain('请输入 4 位验证码');
  });

  it('手机号与验证码合法时提交整表载荷', /** 少传字段会让后端拿不到登录凭据。 */ async () => {
    const { wrapper } = await mountCodeLogin();
    await fillCodeForm(wrapper, { code: '1234', mobile: '13800000000' });

    await clickSubmit(wrapper);

    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      code: '1234',
      mobile: '13800000000',
    });
  });
});

describe('验证码登录页导航与展示', /** 导航与展示决定用户能否退回密码登录并确认当前页面。 */ () => {
  it('点击返回按钮跳转到默认登录路由', /** 返回失效会让用户被卡在验证码登录页。 */ async () => {
    const { router, wrapper } = await mountCodeLogin();

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/auth/login');
  });

  it('返回按钮跳转使用调用方传入的路径', /** 路径写死会让不同应用跳转到本系统不存在的页面。 */ async () => {
    const { router, wrapper } = await mountCodeLogin({
      loginPath: '/custom/login',
    });

    await wrapper.findAll('button')[1]?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/custom/login');
  });

  it('关闭返回按钮后只保留提交按钮', /** 配置无效会在不应出现返回入口的页面留下多余按钮。 */ async () => {
    const { wrapper } = await mountCodeLogin({ showBack: false });

    expect(wrapper.findAll('button')).toHaveLength(1);
  });

  it('加载态在按钮上呈现等待样式并禁止重复点击', /** 未置加载态会让用户重复点击并重复发送短信。 */ async () => {
    const { wrapper } = await mountCodeLogin({ loading: true });

    const button = wrapper.findAll('button')[0];
    expect(button?.classes()).toContain('cursor-wait');
    expect(button?.attributes('disabled')).toBeDefined();
    expect(button?.find('.animate-spin').exists()).toBe(true);
  });

  it('标题、说明与提交按钮文案可由属性覆盖', /** 文案写死会让业务无法按自己的登录方式提示用户。 */ async () => {
    const { wrapper } = await mountCodeLogin({
      submitButtonText: 'DUMMY-登录按钮',
      subTitle: 'DUMMY-验证码说明',
      title: 'DUMMY-验证码标题',
    });

    expect(wrapper.text()).toContain('DUMMY-验证码标题');
    expect(wrapper.text()).toContain('DUMMY-验证码说明');
    expect(wrapper.findAll('button')[0]?.text()).toBe('DUMMY-登录按钮');
  });

  it('标题与说明插槽覆盖默认文案', /** 插槽失效会让业务无法替换认证页标题。 */ async () => {
    const { wrapper } = await mountCodeLogin(
      {},
      {
        subTitle: '<span data-test="sub-title">DUMMY-插槽说明</span>',
        title: '<span data-test="title">DUMMY-插槽标题</span>',
      },
    );

    expect(wrapper.get('[data-test="title"]').text()).toBe('DUMMY-插槽标题');
    expect(wrapper.get('[data-test="sub-title"]').text()).toBe(
      'DUMMY-插槽说明',
    );
  });

  it('向调用方暴露真实表单操作实例', /** 父组件拿不到表单实例就无法在发送验证码后回填或重置表单。 */ async () => {
    const { wrapper } = await mountCodeLogin();
    await fillCodeForm(wrapper, { code: '1234', mobile: '13800000000' });

    const exposed = (wrapper.vm as unknown as ExposedFormApi).getFormApi();

    await expect(exposed.getValues()).resolves.toEqual({
      code: '1234',
      mobile: '13800000000',
    });
  });
});
